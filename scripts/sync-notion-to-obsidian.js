#!/usr/bin/env node
// Sync Notion → Obsidian (one-way). Rodar manualmente por agora.
// Uso:
//   node scripts/sync-notion-to-obsidian.js              # sync real
//   node scripts/sync-notion-to-obsidian.js --dry-run    # só lista

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('@notionhq/client');

// ───── Config ─────────────────────────────────────────────────────────
const HUB_ID = '33c348c5-f722-8174-a6c1-c821f5579aaa';
const VAULT_PATH = process.env.OBSIDIAN_VAULT_PATH;
const SUBDIR = 'Notion Sync';
const MAX_DEPTH = 4;
const DRY_RUN = process.argv.includes('--dry-run');

if (!process.env.NOTION_TOKEN) { console.error('❌ NOTION_TOKEN ausente'); process.exit(1); }
if (!VAULT_PATH) { console.error('❌ OBSIDIAN_VAULT_PATH ausente'); process.exit(1); }

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const visited = new Set();
const stats = { pagesRead: 0, filesWritten: 0, errors: 0, skipped: 0 };

// ───── Utils ──────────────────────────────────────────────────────────
function sanitize(name) {
  return (name || 'untitled')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

function indent(text, prefix = '  ') {
  return text.split('\n').map(l => prefix + l).join('\n');
}

async function paginatedList(fn) {
  const results = [];
  let cursor = undefined;
  do {
    const resp = await fn(cursor);
    results.push(...resp.results);
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);
  return results;
}

// ───── Conversão rich_text ────────────────────────────────────────────
function richTextToMd(rt) {
  if (!rt || !rt.length) return '';
  return rt.map(r => {
    if (r.type === 'equation') return '$' + r.equation.expression + '$';
    if (r.type === 'mention') {
      if (r.mention.type === 'page') return '[[' + r.plain_text + ']]';
      return r.plain_text;
    }
    let t = r.plain_text || '';
    const a = r.annotations || {};
    if (a.code) t = '`' + t + '`';
    if (a.bold) t = '**' + t + '**';
    if (a.italic) t = '*' + t + '*';
    if (a.strikethrough) t = '~~' + t + '~~';
    if (r.href) t = '[' + t + '](' + r.href + ')';
    return t;
  }).join('');
}

// ───── Conversão de bloco ─────────────────────────────────────────────
function blockToMd(block, childrenMd = '') {
  const t = block.type;
  const b = block[t];
  try {
    switch (t) {
      case 'paragraph': {
        const txt = richTextToMd(b.rich_text);
        return txt + (childrenMd ? '\n\n' + indent(childrenMd) : '');
      }
      case 'heading_1': return '# ' + richTextToMd(b.rich_text);
      case 'heading_2': return '## ' + richTextToMd(b.rich_text);
      case 'heading_3': return '### ' + richTextToMd(b.rich_text);
      case 'bulleted_list_item': {
        const txt = richTextToMd(b.rich_text);
        return '- ' + txt + (childrenMd ? '\n' + indent(childrenMd, '  ') : '');
      }
      case 'numbered_list_item': {
        const txt = richTextToMd(b.rich_text);
        return '1. ' + txt + (childrenMd ? '\n' + indent(childrenMd, '   ') : '');
      }
      case 'to_do': {
        const chk = b.checked ? '[x]' : '[ ]';
        return '- ' + chk + ' ' + richTextToMd(b.rich_text);
      }
      case 'quote': return '> ' + richTextToMd(b.rich_text).replace(/\n/g, '\n> ');
      case 'callout': {
        const icon = b.icon?.emoji || '💡';
        const txt = richTextToMd(b.rich_text);
        return '> [!NOTE] ' + icon + '\n> ' + txt.replace(/\n/g, '\n> ');
      }
      case 'toggle': {
        const s = richTextToMd(b.rich_text);
        return '<details>\n<summary>' + s + '</summary>\n\n' + childrenMd + '\n\n</details>';
      }
      case 'code': {
        const lang = b.language || '';
        const code = (b.rich_text || []).map(r => r.plain_text).join('');
        return '```' + lang + '\n' + code + '\n```';
      }
      case 'divider': return '---';
      case 'child_page': return '[[' + sanitize(b.title) + ']]';
      case 'child_database': return '**📊 Database: ' + (b.title || 'sem título') + '** _(não sincronizado)_';
      case 'image': {
        const url = b.type === 'external' ? b.external.url : b.file?.url;
        return url ? '![](' + url + ')' : '<!-- imagem -->';
      }
      case 'bookmark':
      case 'link_preview':
      case 'embed': {
        const url = b.url;
        return url ? '[' + url + '](' + url + ')' : '<!-- ' + t + ' -->';
      }
      case 'video':
      case 'audio':
      case 'file':
      case 'pdf': {
        const url = b.type === 'external' ? b.external.url : b.file?.url;
        return url ? '[' + t + '](' + url + ')' : '<!-- ' + t + ' -->';
      }
      case 'table': return childrenMd;
      case 'table_row': {
        return '| ' + (b.cells || []).map(c => richTextToMd(c)).join(' | ') + ' |';
      }
      case 'equation': return '$$' + b.expression + '$$';
      case 'synced_block':
      case 'column_list':
      case 'column':
        return childrenMd;
      default:
        return '<!-- [bloco não suportado: ' + t + '] -->';
    }
  } catch (e) {
    console.error('  ⚠️  erro em bloco ' + t + ':', e.message);
    stats.errors++;
    return '<!-- [erro ao converter ' + t + '] -->';
  }
}

// ───── Recursão de blocos ────────────────────────────────────────────
async function renderBlocks(parentId) {
  const blocks = await paginatedList(cursor =>
    notion.blocks.children.list({ block_id: parentId, start_cursor: cursor, page_size: 100 })
  );

  const parts = [];
  for (const blk of blocks) {
    let childrenMd = '';
    if (blk.has_children && blk.type !== 'child_page' && blk.type !== 'child_database') {
      childrenMd = await renderBlocks(blk.id);
    }
    parts.push(blockToMd(blk, childrenMd));
  }
  return parts.filter(Boolean).join('\n\n');
}

// ───── Título da página ──────────────────────────────────────────────
function extractTitle(page) {
  const props = page.properties || {};
  for (const k of Object.keys(props)) {
    if (props[k].type === 'title' && props[k].title?.length) {
      return props[k].title.map(t => t.plain_text).join('');
    }
  }
  return 'untitled-' + page.id.slice(0, 8);
}

// ───── Processa uma página ──────────────────────────────────────────
async function processPage(pageId, depth = 0) {
  if (visited.has(pageId)) { stats.skipped++; return; }
  visited.add(pageId);
  if (depth > MAX_DEPTH) {
    console.warn('  ⚠️  profundidade máxima atingida em', pageId);
    return;
  }

  let page;
  try {
    page = await notion.pages.retrieve({ page_id: pageId });
  } catch (e) {
    console.error('  ⚠️  não consegui ler página', pageId, '—', e.message);
    stats.errors++;
    return;
  }
  stats.pagesRead++;

  const title = extractTitle(page);
  const indent = '  '.repeat(depth);
  console.log(indent + '📄 ' + title + (DRY_RUN ? ' [dry-run]' : ''));

  const body = await renderBlocks(pageId);
  const frontmatter = [
    '---',
    'notion_id: ' + page.id,
    'notion_url: ' + page.url,
    'last_edited: ' + page.last_edited_time,
    'synced_at: ' + new Date().toISOString(),
    '---',
    '',
  ].join('\n');

  const content = frontmatter + '# ' + title + '\n\n' + body + '\n';
  const filename = sanitize(title) + '.md';
  const filepath = path.join(VAULT_PATH, SUBDIR, filename);

  if (!DRY_RUN) {
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, content, 'utf8');
    stats.filesWritten++;
  }

  // Recursa em subpáginas
  const childBlocks = await paginatedList(cursor =>
    notion.blocks.children.list({ block_id: pageId, start_cursor: cursor, page_size: 100 })
  );
  for (const blk of childBlocks) {
    if (blk.type === 'child_page') {
      await processPage(blk.id, depth + 1);
    }
  }
}

// ───── Main ──────────────────────────────────────────────────────────
(async () => {
  const start = Date.now();
  console.log('\n' + (DRY_RUN ? '🔍 DRY-RUN' : '📝 SYNC REAL'));
  console.log('Vault:', VAULT_PATH);
  console.log('Destino:', path.join(VAULT_PATH, SUBDIR));
  console.log('Hub:', HUB_ID, '\n');

  try {
    await processPage(HUB_ID);
  } catch (e) {
    console.error('\n❌ Erro fatal:', e.message);
    process.exit(1);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log('\n─── Resumo ───');
  console.log('Páginas lidas:', stats.pagesRead);
  console.log('Arquivos escritos:', DRY_RUN ? '0 (dry-run)' : stats.filesWritten);
  console.log('Pulos (duplicados):', stats.skipped);
  console.log('Erros:', stats.errors);
  console.log('Tempo:', elapsed + 's');
})();

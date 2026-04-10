const { google } = require('googleapis');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'urn:ietf:wg:oauth:2.0:oob'
);

const url = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/calendar'],
  prompt: 'consent'
});

console.log('\n🔗 Abre essa URL no navegador:\n');
console.log(url);
console.log('\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Cole o código que o Google te deu: ', async (code) => {
  rl.close();
  try {
    const { tokens } = await oauth2Client.getToken(code);
    const envPath = path.join(__dirname, '../.env');
    let env = fs.readFileSync(envPath, 'utf8');
    env = env.replace('GOOGLE_REFRESH_TOKEN=', `GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    fs.writeFileSync(envPath, env);
    console.log('\n✅ Refresh token salvo no .env!');
    console.log('🎉 Google Calendar pronto para usar!');
  } catch (err) {
    console.error('Erro:', err.message);
  }
});

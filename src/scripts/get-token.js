const { google } = require('googleapis');
require('dotenv').config();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'urn:ietf:wg:oauth:2.0:oob'
);

oauth2Client.getToken('4/1Aci98E9ax5vF7i3dMJdLJvAHckQArwE0jwPbWAg9E5W_lg-NRKfSL8sAmTg').then(({ tokens }) => {
  console.log('\n✅ REFRESH TOKEN:\n');
  console.log(tokens.refresh_token);
});
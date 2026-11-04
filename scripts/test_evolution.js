import { db } from './db.js';

const config = db.prepare('SELECT * FROM evolution_config WHERE id = 1').get();
console.log('CONFIG:', config);

const endpoint = `${config.base_url.replace(/\/$/, '')}/message/sendText/${config.instance_name}`;
console.log('ENDPOINT:', endpoint);

// Test with current payload structure
const payload1 = {
  number: '5571992610248',
  options: {
    delay: 1200,
    presence: 'composing',
    linkPreview: false
  },
  textMessage: {
    text: '🧪 Teste TRACERT+ Evolution API payload 1'
  }
};

// Test with flat text payload structure
const payload2 = {
  number: '5571992610248',
  text: '🧪 Teste TRACERT+ Evolution API payload 2'
};

async function test() {
  console.log('Testing payload1:');
  try {
    const res1 = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': config.api_key
      },
      body: JSON.stringify(payload1)
    });
    console.log('Status 1:', res1.status);
    const body1 = await res1.text();
    console.log('Body 1:', body1);
  } catch (e) {
    console.log('Error 1:', e);
  }

  console.log('\nTesting payload2:');
  try {
    const res2 = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': config.api_key
      },
      body: JSON.stringify(payload2)
    });
    console.log('Status 2:', res2.status);
    const body2 = await res2.text();
    console.log('Body 2:', body2);
  } catch (e) {
    console.log('Error 2:', e);
  }
}

test();

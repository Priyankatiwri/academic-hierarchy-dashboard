require('dotenv').config();
const { initSchema } = require('../src/db');
const { runSync } = require('../src/sync');

initSchema()
  .then(() => runSync())
  .then(result => {
    console.log('Sync complete:', result);
    process.exit(0);
  })
  .catch(err => {
    console.error('Sync failed:', err.message);
    process.exit(1);
  });

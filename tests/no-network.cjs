// Used only by the synthetic OCR integration test, including nested workers.
const deny = () => { throw new Error('Network access is forbidden in offline OCR tests.'); };
globalThis.fetch = deny;
for (const name of ['node:http', 'node:https']) {
  const module = require(name);
  module.request = deny;
  module.get = deny;
}
require('node:net').connect = deny;
require('node:net').createConnection = deny;

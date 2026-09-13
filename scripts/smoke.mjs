import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const client = new Client({ name: 'mun-d2l-smoke-test', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../dist/cli.js', import.meta.url)), 'serve'],
  env: Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)),
  stderr: 'pipe',
});
let diagnostics = '';
transport.stderr?.on('data', chunk => { diagnostics += chunk.toString(); });
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  if (tools.length !== 12) throw new Error('Expected twelve tools.');
  console.log('PASS: MCP handshake and twelve tool definitions.');
  if (process.argv.includes('--live')) {
    const courses = await client.callTool({ name: 'list_courses', arguments: {} });
    if (courses.isError) throw new Error('Live course retrieval failed. Run npm run status.');
    console.log(`PASS: ${courses.structuredContent.total} enrollments retrieved through stdio.`);
    const dates = await client.callTool({ name: 'get_upcoming_deadlines', arguments: { days: 7 } }, undefined, { timeout: 120_000 });
    if (dates.isError) throw new Error('Live deadline retrieval failed.');
    const result = dates.structuredContent;
    console.log(`PASS: ${result.courses_checked} courses checked; ${result.deadlines.length} upcoming items; complete=${result.complete}.`);
  }
  if (diagnostics) console.log('Server produced diagnostic output on stderr; contents omitted.');
} finally { await client.close(); }

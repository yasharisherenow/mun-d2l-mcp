import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { toolValue, classify } from '../dist/verification.js';

const client = new Client({ name: 'mun-d2l-smoke-test', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../dist/cli.js', import.meta.url)), 'serve'],
  env: Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined)),
  stderr: 'pipe',
});
let diagnostics = false;
transport.stderr?.on('data', chunk => { diagnostics = true; });
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  if (tools.length !== 12) throw new Error('Expected twelve tools.');
  console.log('PASS: MCP handshake and twelve tool definitions.');
  if (process.argv.includes('--live')) {
    const courses = await client.callTool({ name: 'list_courses', arguments: {} });
    toolValue(courses);
    console.log(`PASS: ${courses.structuredContent.total} enrollments retrieved through stdio.`);
    const dates = await client.callTool({ name: 'get_upcoming_deadlines', arguments: { days: 7 } }, undefined, { timeout: 120_000 });
    toolValue(dates);
    const result = dates.structuredContent;
    console.log(`PASS: ${result.courses_checked} courses checked; ${result.deadlines.length} upcoming items; complete=${result.complete}.`);
  }
  if (diagnostics) console.log('Server produced diagnostic output on stderr; contents omitted.');
} catch (error) {
  console.error(`FAIL: ${classify(error?.code).code}`);
  process.exitCode = 1;
} finally { await client.close(); }

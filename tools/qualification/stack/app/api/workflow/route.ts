import {serve as serveWorkflow} from '@upstash/workflow/nextjs';

// Import/type/runtime compatibility only. This route deliberately makes no
// workflow request and does not require UPSTASH credentials.
export function GET() {
  return new Response(JSON.stringify({
    route: 'loopback-stack-probe',
    workflowBinding: typeof serveWorkflow,
    providerCall: false,
  }), {headers: {'content-type': 'application/json'}});
}

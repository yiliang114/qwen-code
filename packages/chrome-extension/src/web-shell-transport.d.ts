import type { DaemonTransport } from '@qwen-code/sdk/daemon';
import '@qwen-code/web-shell';

declare module '@qwen-code/web-shell' {
  interface WebShellWithProvidersProps {
    transport?: DaemonTransport;
  }
}

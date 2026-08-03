import { NativeModule, requireNativeModule } from 'expo';

import type {
  ConnectResult,
  ExecResult,
  HerdrSshEvents,
  NativeSshConfig,
  StartStreamResult,
} from './HerdrSsh.types';

declare class HerdrSshModule extends NativeModule<HerdrSshEvents> {
  /**
   * Open (or reuse) the connection registered under `id`. Idempotent: called on
   * a live, authenticated connection it returns immediately with the accepted
   * fingerprint rather than dialling again.
   */
  connect(id: string, config: NativeSshConfig): Promise<ConnectResult>;
  /** Close and forget the connection, and every stream running on it. */
  disconnect(id: string): Promise<void>;
  /** Run a command to completion and collect its output. */
  exec(id: string, command: string): Promise<ExecResult>;
  /**
   * Run a long-lived command (`tail -f`) and emit its stdout line by line as
   * `onStreamLine` events tagged with `streamId`.
   */
  startStream(id: string, streamId: string, command: string): Promise<StartStreamResult>;
  /** Stop a stream and tear down its channel. Safe to call on a dead stream. */
  stopStream(streamId: string): Promise<void>;
}

export default requireNativeModule<HerdrSshModule>('HerdrSsh');

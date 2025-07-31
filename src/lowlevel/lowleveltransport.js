/* @flow */

import {patch} from './protobuf/monkey_patch';
patch();

import {create as createDefered} from '../defered';
import {parseConfigure} from './protobuf/parse_protocol';
import {buildAndSend} from './send';
import {receiveAndParse} from './receive';
import {resolveTimeoutPromise} from '../defered';

// eslint-disable-next-line quotes
const stringify = require('json-stable-stringify');

import type {LowlevelTransportSharedPlugin, TrezorDeviceInfoDebug} from './sharedPlugin';
import type {Defered} from '../defered';
import type {Messages} from './protobuf/messages';
import type {MessageFromTrezor, TrezorDeviceInfoWithSession, AcquireInput} from '../transport';

import {debugInOut} from '../debug-decorator';

function stableStringify(devices: ?Array<TrezorDeviceInfoWithSession>): string {
  if (devices == null) {
    return `null`;
  }

  const pureDevices = devices.map(device => {
    const path = device.path;
    const session = device.session == null ? null : device.session;
    return {path, session};
  });

  return stringify(pureDevices);
}

function compare(a: TrezorDeviceInfoWithSession, b: TrezorDeviceInfoWithSession): number {
  if (!isNaN(parseInt(a.path))) {
    return parseInt(a.path) - parseInt(b.path);
  } else {
    return a.path < b.path ? -1 : (a.path > b.path ? 1 : 0);
  }
}

const ITER_MAX = 60;
const ITER_DELAY = 500;

export default class LowlevelTransportWithSharedConnections {
  name: string = `LowlevelTransportWithSharedConnections`;

  plugin: LowlevelTransportSharedPlugin;
  debug: boolean = false;

  sessionIdCounter = 0;
  sessions = Object.assign(Object.create(null), {
    debugSessions: Object.create(null),  // path => session
    normalSessions: Object.create(null), // path => session
  });

  // path => promise rejecting on release
  deferedDebugOnRelease: {[session: string]: Defered<void>} = Object.create(null);
  deferedNormalOnRelease: {[session: string]: Defered<void>} = Object.create(null);

  _messages: ?Messages;
  version: string;
  configured: boolean = false;
  stopped: boolean = false;

  constructor(plugin: LowlevelTransportSharedPlugin) {
    this.plugin = plugin;
    this.version = plugin.version;
    if (!this.plugin.allowsWriteAndEnumerate) {
      // This should never happen anyway
      throw new Error(`Plugin with shared connections cannot disallow write and enumerate`);
    }
  }

  @debugInOut
  enumerate(): Promise<Array<TrezorDeviceInfoWithSession>> {
    return this._silentEnumerate();
  }

  async _silentEnumerate(): Promise<Array<TrezorDeviceInfoWithSession>> {
    let devices: Array<TrezorDeviceInfoDebug> = await this.plugin.enumerate();
    
    const debugSessions = this.sessions.debugSessions;
    const normalSessions = this.sessions.normalSessions;

    const devicesWithSessions = devices.map(device => {
      const session = normalSessions[device.path];
      const debugSession = debugSessions[device.path];
      return {
        path: device.path,
        session: session,
        debug: device.debug,
        debugSession: debugSession,
      };
    });

    this._releaseDisconnected(devicesWithSessions);
    return devicesWithSessions.sort(compare);
  }

  _releaseDisconnected(devices: Array<TrezorDeviceInfoWithSession>) {
    const connected: {[session: string]: boolean} = Object.create(null);
    devices.forEach(device => {
      if (device.session != null) {
        connected[device.session] = true;
      }
    });
    Object.keys(this.deferedDebugOnRelease).forEach(session => {
      if (connected[session] == null) {
        this._releaseCleanup(session, true);
      }
    });
    Object.keys(this.deferedNormalOnRelease).forEach(session => {
      if (connected[session] == null) {
        this._releaseCleanup(session, false);
      }
    });
  }

  _lastStringified: string = ``;

  @debugInOut
  async listen(old: ?Array<TrezorDeviceInfoWithSession>): Promise<Array<TrezorDeviceInfoWithSession>> {
    const oldStringified = stableStringify(old);
    const last = old == null ? this._lastStringified : oldStringified;
    return this._runIter(0, last);
  }

  async _runIter(iteration: number, oldStringified: string): Promise<Array<TrezorDeviceInfoWithSession>> {
    const devices = await this._silentEnumerate();
    const stringified = stableStringify(devices);
    if ((stringified !== oldStringified) || (iteration === ITER_MAX)) {
      this._lastStringified = stringified;
      return devices;
    }
    await resolveTimeoutPromise(ITER_DELAY, null);
    return this._runIter(iteration + 1, stringified);
  }

  @debugInOut
  async acquire(input: AcquireInput, debugLink: boolean): Promise<string> {

    const previous = this.sessions[debugLink ? `debugSessions` : `normalSessions`][input.path];
    if (input.previous != previous) {
        throw new Error(`wrong previous session`);
    }
    await this.plugin.connect(input.path, debugLink, true);

    const session: string = `${this.sessionIdCounter++}`;
    this.sessions[debugLink ? `debugSessions` : `normalSessions`][input.path] = session;
    if (debugLink) {
      this.deferedDebugOnRelease[session] = createDefered();
    } else {
      this.deferedNormalOnRelease[session] = createDefered();
    }
    return session;
  }

  @debugInOut
  async release(session: string, onclose: boolean, debugLink: boolean): Promise<void> {
    const path = Object.entries(this.sessions[debugLink ? `debugSessions` : `normalSessions`]).find(([_, s]) => s === session)?.[0];
    if (path == null) {
      throw new Error(`Trying to double release.`);
    }
    const last = true;

    this._releaseCleanup(session, debugLink);
    try {
      await this.plugin.disconnect(path, debugLink, last);
    } catch (e) {
      // ignore release errors, it's not important that much
    }
  }

  _releaseCleanup(session: string, debugLink: boolean) {
    const table = debugLink ? this.deferedDebugOnRelease : this.deferedNormalOnRelease;
    if (table[session] != null) {
      table[session].reject(new Error(`Device released or disconnected`));
      delete table[session];
    }
  }

  @debugInOut
  async configure(signedData: string): Promise<void> {
    const messages = parseConfigure(signedData);
    this._messages = messages;
    this.configured = true;
  }

  _sendLowlevel(path: string, debug: boolean): (data: ArrayBuffer) => Promise<void> {
    return (data) => this.plugin.send(path, data, debug);
  }

  _receiveLowlevel(path: string, debug: boolean): () => Promise<ArrayBuffer> {
    return () => this.plugin.receive(path, debug);
  }

  messages(): Messages {
    if (this._messages == null) {
      throw new Error(`Transport not configured.`);
    }
    return this._messages;
  }

  async doWithSession<X>(session: string, debugLink: boolean, inside:(path: string) => Promise<X>): Promise<X> {
    const sessionsMM = debugLink ? this.sessions.debugSessions : this.sessions.normalSessions;

    let path_: ?string = null;
    Object.keys(sessionsMM).forEach(kpath => {
      if (sessionsMM[kpath] === session) {
        path_ = kpath;
      }
    });

    if (path_ == null) {
      throw new Error(`Session not available.`);
    }
    const path: string = path_;

    const resPromise = await inside(path);

    const defered = debugLink
      ? this.deferedDebugOnRelease[session]
      : this.deferedNormalOnRelease[session];

    return Promise.race([defered.rejectingPromise, resPromise]);
  }

  @debugInOut
  async call(session: string, name: string, data: Object, debugLink: boolean): Promise<MessageFromTrezor> {
    const callInside: (path: string) => Promise<MessageFromTrezor> = async (path: string) => {
      const messages = this.messages();
      await buildAndSend(messages, this._sendLowlevel(path, debugLink), name, data);
      const message = await receiveAndParse(messages, this._receiveLowlevel(path, debugLink));
      return message;
    };

    return this.doWithSession(session, debugLink, callInside);
  }

  @debugInOut
  async post(session: string, name: string, data: Object, debugLink: boolean): Promise<void> {
    const callInside: (path: string) => Promise<void> = async (path: string) => {
      const messages = this.messages();
      await buildAndSend(messages, this._sendLowlevel(path, debugLink), name, data);
    };

    return this.doWithSession(session, debugLink, callInside);
  }

  @debugInOut
  async read(session: string, debugLink: boolean): Promise<MessageFromTrezor> {
    const callInside: (path: string) => Promise<MessageFromTrezor> = async (path: string) => {
      const messages = this.messages();
      const message = await receiveAndParse(messages, this._receiveLowlevel(path, debugLink));
      return message;
    };

    return this.doWithSession(session, debugLink, callInside);
  }

  @debugInOut
  async init(debug: ?boolean): Promise<void> {
    this.debug = !!debug;
    this.requestNeeded = this.plugin.requestNeeded;
    await this.plugin.init(debug);
  }

  async requestDevice(): Promise<void> {
    return this.plugin.requestDevice();
  }

  requestNeeded: boolean = false;

  latestSessionId: number = 0;

  setBridgeLatestUrl(url: string): void {
  }
  isOutdated: boolean = false;

  stop(): void {
    this.stopped = true;
  }
}
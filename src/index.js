/* @flow */

// export is empty, you can import by "trezor-link/parallel", "trezor-link/lowlevel", "trezor-link/bridge"

export type {Transport, AcquireInput, TrezorDeviceInfoWithSession, MessageFromTrezor} from './transport';

import BridgeTransportV2 from './bridge/v2';
import LowlevelTransportWithSharedConnections from './lowlevel/withSharedConnections';
import FallbackTransport from './fallback';
import WebUsbPlugin from './lowlevel/webusb';

export default {
  BridgeV2: BridgeTransportV2,
  Fallback: FallbackTransport,
  Lowlevel: LowlevelTransportWithSharedConnections,
  WebUsb: WebUsbPlugin,
};

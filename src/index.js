/* @flow */

// export is empty, you can import by "trezor-link/parallel", "trezor-link/lowlevel", "trezor-link/bridge"

export type {Transport, AcquireInput, TrezorDeviceInfoWithSession, MessageFromTrezor} from './transport';

import BridgeTransportV2 from './bridge/v2';
import LowlevelTransport from './lowlevel/lowleveltransport';
import WebUsbPlugin from './lowlevel/webusb';

export default {
  BridgeV2: BridgeTransportV2,
  Lowlevel: LowlevelTransport,
  WebUsb: WebUsbPlugin,
};

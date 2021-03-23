/* @flow */

// Just testing that the classes are actually the correct types
import type {Transport} from '../transport';

import BridgeTransport2 from '../bridge/v2';

function acceptsTransport(t: Transport) {}

acceptsTransport(new BridgeTransport2());

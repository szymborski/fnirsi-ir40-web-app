// FNIRSI IR40 BLE client. Protocol: see AGENTS.md.
// Packet = u16 BE payload length + N records of 7 bytes: 02 <tag> <type> <u32 BE value>.

const SERVICE = 0xee01;
const RX_CHAR = 0xee02; // notify: device -> app
const TX_CHAR = 0xee03; // write: app -> device

export const TAG = { MODE: 0x01, SIDE_A: 0x02, SIDE_B: 0x03, RESULT: 0x05, UNIT: 0x06, CONTINUOUS: 0x08, REFERENCE: 0x0a };
export const MODE = { LINEAR: 0 };

export const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

// Parse one notification. Return map tag -> value, or null if packet is not valid.
export function parsePacket(bytes) {
  if (bytes.length < 2) return null;
  const len = (bytes[0] << 8) | bytes[1];
  const end = Math.min(bytes.length, 2 + len);
  const fields = {};
  let ok = false;
  for (let i = 2; i + 7 <= end; i += 7) {
    if (bytes[i] !== 0x02) break;
    const tag = bytes[i + 1];
    const value = ((bytes[i + 3] << 24) >>> 0) + (bytes[i + 4] << 16) + (bytes[i + 5] << 8) + bytes[i + 6];
    fields[tag] = value;
    ok = true;
  }
  return ok ? fields : null;
}

export class IR40 extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.rx = null;
    this.tx = null;
    this.state = 'disconnected'; // disconnected | connecting | connected
    this.unit = 0;
    this.manualDisconnect = false;
    this.log = []; // last raw packets, for the debug view
    this.onValue = (e) => this.onPacket(e.target.value);
  }

  static get supported() {
    return !!navigator.bluetooth?.requestDevice;
  }

  setState(state) {
    this.state = state;
    this.dispatchEvent(new CustomEvent('state', { detail: state }));
  }

  // Must run from a user gesture (tap). Browser shows the device chooser.
  async connect() {
    if (!IR40.supported) throw new Error('Ta przeglądarka nie obsługuje Web Bluetooth');
    this.setState('connecting');
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'FNIRSI' }, { namePrefix: 'fnirsi' }, { services: [SERVICE] }],
        optionalServices: [SERVICE],
      });
      this.attach(device);
      await this.openGatt();
    } catch (e) {
      this.setState('disconnected');
      throw e;
    }
  }

  // Add the disconnect listener only once per device object.
  attach(device) {
    this.device = device;
    this.seen = this.seen || new WeakSet();
    if (this.seen.has(device)) return;
    this.seen.add(device);
    device.addEventListener('gattserverdisconnected', () => this.onDisconnected());
  }

  // Connect to a device the user picked before. No chooser. Bluefy and Chrome (with flag) give getDevices().
  async reconnectKnown() {
    if (!navigator.bluetooth?.getDevices || this.state !== 'disconnected') return false;
    try {
      const list = await navigator.bluetooth.getDevices();
      const device = list.find((d) => /fnirsi/i.test(d.name || ''));
      if (!device) return false;
      this.attach(device);
      this.setState('connecting');
      await this.openGatt();
      return true;
    } catch {
      this.setState('disconnected');
      return false;
    }
  }

  async openGatt() {
    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE);
    this.rx = await service.getCharacteristic(RX_CHAR);
    this.tx = await service.getCharacteristic(TX_CHAR);
    // Same function reference: browser adds it only once, also after reconnect.
    this.rx.addEventListener('characteristicvaluechanged', this.onValue);
    await this.rx.startNotifications();
    this.manualDisconnect = false;
    this.setState('connected');
  }

  // Try again without the chooser. Device object stays valid while page is open.
  async onDisconnected() {
    this.rx = this.tx = null;
    this.setState('disconnected');
    if (this.manualDisconnect || !this.device) return;
    for (let i = 0; i < 3 && this.state !== 'connected'; i++) {
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      try {
        this.setState('connecting');
        await this.openGatt();
      } catch {
        this.setState('disconnected');
      }
    }
  }

  disconnect() {
    this.manualDisconnect = true;
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this.setState('disconnected');
  }

  onPacket(dataView) {
    const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
    this.log.unshift({ t: Date.now(), hex: hex(bytes) });
    this.log.length = Math.min(this.log.length, 50);
    const f = parsePacket(bytes);
    if (!f) return;
    if (TAG.UNIT in f) this.unit = f[TAG.UNIT];
    if (TAG.RESULT in f) {
      const mode = f[TAG.MODE] ?? MODE.LINEAR;
      this.dispatchEvent(new CustomEvent('measure', { detail: { mode, mm: f[TAG.RESULT], unit: this.unit, fields: f } }));
    }
  }

  async send(bytes) {
    if (!this.tx) throw new Error('Brak połączenia');
    await this.tx.writeValue(new Uint8Array(bytes));
  }

  // Test mode. Make a fake linear reading.
  simulate(mm) {
    const v = mm ?? Math.round(300 + Math.random() * 4000);
    const b = [0x00, 0x15, 0x02, 0x01, 0x14, 0, 0, 0, 0, 0x02, 0x05, 0x14, 0, 0, (v >> 8) & 0xff, v & 0xff, 0x02, 0x06, 0x14, 0, 0, 0, 0];
    this.onPacket(new DataView(new Uint8Array(b).buffer));
  }
}

export const ir40 = new IR40();

// Builds small synthetic captures (classic pcap, Ethernet) for the tests, so no
// real capture - which could contain customer data - ever has to live in this
// public repository. Only the protocol details the analyses look at are
// modelled: Ethernet/VLAN, ARP, IPv4, UDP, TCP (with per-flow sequence numbers),
// ICMP, DNS, TLS hellos and the layer-2 control protocols.
// thought up by human, created by ai

export const mac = (text) => Buffer.from(text.split(':').map((part) => parseInt(part, 16)));
export const u16 = (value) => { const b = Buffer.alloc(2); b.writeUInt16BE(value); return b; };
export const u32 = (value) => { const b = Buffer.alloc(4); b.writeUInt32BE(value >>> 0); return b; };

export const MAC_A = '00:aa:bb:cc:dd:01';
export const MAC_B = '00:aa:bb:cc:dd:02';
export const MAC_C = '00:11:22:33:44:55';
export const MAC_D = '00:11:22:33:44:66';

export function ethernet(dst, src, type, payload, vlan = null) {
  const parts = [mac(dst), mac(src)];
  if (vlan !== null) parts.push(u16(0x8100), u16(vlan));
  parts.push(u16(type), payload);
  return Buffer.concat(parts);
}

/** 802.3 frame (length field instead of an Ethertype) carrying an LLC payload. */
export function ethernet8023(dst, src, llc) {
  return Buffer.concat([mac(dst), mac(src), u16(llc.length), llc]);
}

export function ipv4(src, dst, protocol, l4, { flagsFragment = 0x4000 } = {}) {
  const header = Buffer.alloc(20);
  header[0] = 0x45;
  header.writeUInt16BE(20 + l4.length, 2);
  header.writeUInt16BE(flagsFragment, 6);
  header[8] = 64;
  header[9] = protocol;
  src.split('.').forEach((octet, i) => { header[12 + i] = Number(octet); });
  dst.split('.').forEach((octet, i) => { header[16 + i] = Number(octet); });
  return Buffer.concat([header, l4]);
}

// ----------------------------------------------------------------- DNS / TLS

function dnsName(name) {
  return Buffer.concat([...name.split('.').map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label)])), Buffer.from([0])]);
}

export function dnsQuery(id, name, type = 1) {
  return Buffer.concat([u16(id), u16(0x0100), u16(1), u16(0), u16(0), u16(0), dnsName(name), u16(type), u16(1)]);
}

/** `answers`: arrays of 4 (A) or 16 (AAAA) address bytes. */
export function dnsResponse(id, name, rcode, answers = [], type = 1) {
  const records = answers.map((address) => Buffer.concat([Buffer.from([0xc0, 12]), u16(address.length === 4 ? 1 : 28), u16(1), u32(60), u16(address.length), Buffer.from(address)]));
  return Buffer.concat([u16(id), u16(0x8180 | rcode), u16(1), u16(records.length), u16(0), u16(0), dnsName(name), u16(type), u16(1), ...records]);
}

export function mdnsQuery(names) {
  return Buffer.concat([u16(0), u16(0), u16(names.length), u16(0), u16(0), u16(0), ...names.map((n) => Buffer.concat([dnsName(n), u16(12), u16(1)]))]);
}

const tlsExtension = (type, body) => Buffer.concat([u16(type), u16(body.length), body]);

export function tlsServerHello({ legacy = 0x0303, cipher, selectedVersion = 0 }) {
  const extensions = selectedVersion ? tlsExtension(0x002b, u16(selectedVersion)) : Buffer.alloc(0);
  const body = Buffer.concat([u16(legacy), Buffer.alloc(32, 1), Buffer.from([0]), u16(cipher), Buffer.from([0]), u16(extensions.length), extensions]);
  const handshake = Buffer.concat([Buffer.from([2, 0]), u16(body.length), body]);
  return Buffer.concat([Buffer.from([0x16, 3, 3]), u16(handshake.length), handshake]);
}

export function tlsClientHello({ sni = null, versions = [0x0304, 0x0303] } = {}) {
  const parts = [];
  if (sni) {
    const name = Buffer.from(sni);
    parts.push(tlsExtension(0, Buffer.concat([u16(name.length + 3), Buffer.from([0]), u16(name.length), name])));
  }
  parts.push(tlsExtension(0x002b, Buffer.concat([Buffer.from([versions.length * 2]), ...versions.map(u16)])));
  const extensions = Buffer.concat(parts);
  const body = Buffer.concat([u16(0x0303), Buffer.alloc(32, 2), Buffer.from([0]), u16(4), u16(0x1301), u16(0xc02f), Buffer.from([1, 0]), u16(extensions.length), extensions]);
  const handshake = Buffer.concat([Buffer.from([1, 0]), u16(body.length), body]);
  return Buffer.concat([Buffer.from([0x16, 3, 1]), u16(handshake.length), handshake]);
}

// --------------------------------------------------------------- layer 2

export function bpdu({ topologyChange = false, root, bridge }) {
  const b = Buffer.alloc(35);
  b[4] = topologyChange ? 1 : 0;
  u16(root.priority).copy(b, 5);
  mac(root.mac).copy(b, 7);
  u32(4).copy(b, 13);
  u16(bridge.priority).copy(b, 17);
  mac(bridge.mac).copy(b, 19);
  return b;
}

const cdpTlv = (type, value) => Buffer.concat([u16(type), u16(value.length + 4), value]);
export function cdpFrame({ deviceId, portId, platform, mgmtIp }) {
  return Buffer.concat([
    Buffer.from([2, 180, 0, 0]),
    cdpTlv(1, Buffer.from(deviceId)),
    cdpTlv(3, Buffer.from(portId)),
    cdpTlv(6, Buffer.from(platform)),
    cdpTlv(4, u32(0x08)),
    cdpTlv(2, Buffer.concat([u32(1), Buffer.from([1, 1, 0xcc]), u16(4), Buffer.from(mgmtIp.split('.').map(Number))])),
  ]);
}

const lldpTlv = (type, value) => { const h = Buffer.alloc(2); h.writeUInt16BE((type << 9) | value.length); return Buffer.concat([h, value]); };
export function lldpFrame({ chassisMac, portId, systemName, mgmtIp }) {
  return Buffer.concat([
    lldpTlv(1, Buffer.concat([Buffer.from([4]), mac(chassisMac)])),
    lldpTlv(2, Buffer.concat([Buffer.from([5]), Buffer.from(portId)])),
    lldpTlv(3, u16(120)),
    lldpTlv(5, Buffer.from(systemName)),
    lldpTlv(8, Buffer.concat([Buffer.from([5, 1, ...mgmtIp.split('.').map(Number), 2]), u32(1), Buffer.from([0])])),
    lldpTlv(0, Buffer.alloc(0)),
  ]);
}

// --------------------------------------------------------------- builder

export class CaptureBuilder {
  constructor({ start = 1_000_000 } = {}) {
    this.time = start;
    this.packets = [];
    this.sequence = new Map();
    this.nextDnsId = 100;
  }

  /** Appends a raw Ethernet frame `dt` seconds after the previous one. */
  frame(buffer, dt = 0.1) {
    this.time += dt;
    this.packets.push({ time: this.time, buffer });
    return this;
  }

  /** Moves the clock without emitting a packet. */
  wait(seconds) {
    this.time += seconds;
    return this;
  }

  udp(src, dst, srcPort, dstPort, payload, { dt = 0.1, dstMac = MAC_B, srcMac = MAC_A, vlan = null } = {}) {
    const header = Buffer.alloc(8);
    header.writeUInt16BE(srcPort, 0);
    header.writeUInt16BE(dstPort, 2);
    header.writeUInt16BE(8 + payload.length, 4);
    return this.frame(ethernet(dstMac, srcMac, 0x0800, ipv4(src, dst, 17, Buffer.concat([header, payload])), vlan), dt);
  }

  /** TCP segment; sequence numbers advance per direction of the flow, so retransmissions only happen on request. */
  tcp(src, dst, srcPort, dstPort, payload = Buffer.alloc(0), { flags = 0x18, dt = 0.1, seq = null, ack = 0, window = 65535 } = {}) {
    const flow = `${src}:${srcPort}>${dst}:${dstPort}`;
    const sequence = seq !== null ? seq : this.sequence.get(flow) ?? 1;
    const header = Buffer.alloc(20);
    header.writeUInt16BE(srcPort, 0);
    header.writeUInt16BE(dstPort, 2);
    header.writeUInt32BE(sequence >>> 0, 4);
    header.writeUInt32BE(ack >>> 0, 8);
    header[12] = 0x50;
    header[13] = flags;
    header.writeUInt16BE(window, 14);
    const consumed = payload.length + ((flags & 0x02) ? 1 : 0) + ((flags & 0x01) ? 1 : 0);
    if (seq === null) this.sequence.set(flow, sequence + consumed);
    return this.frame(ethernet(MAC_B, MAC_A, 0x0800, ipv4(src, dst, 6, Buffer.concat([header, payload]))), dt);
  }

  icmp(src, dst, type, code = 0, { dt = 0.1 } = {}) {
    const header = Buffer.alloc(8);
    header[0] = type;
    header[1] = code;
    return this.frame(ethernet(MAC_B, MAC_A, 0x0800, ipv4(src, dst, 1, header, { flagsFragment: 0 })), dt);
  }

  arpRequest(senderIp, targetIp, { dt = 0.1 } = {}) {
    const arp = Buffer.alloc(28);
    arp.writeUInt16BE(1, 0);
    arp.writeUInt16BE(0x0800, 2);
    arp[4] = 6;
    arp[5] = 4;
    arp.writeUInt16BE(1, 6);
    mac(MAC_A).copy(arp, 8);
    Buffer.from(senderIp.split('.').map(Number)).copy(arp, 14);
    Buffer.from(targetIp.split('.').map(Number)).copy(arp, 24);
    return this.frame(ethernet('ff:ff:ff:ff:ff:ff', MAC_A, 0x0806, arp), dt);
  }

  /** One DNS lookup: query and (unless `answer === false`) the response `gap` seconds later. */
  dnsLookup(client, server, name, { rcode = 0, answers = [], gap = 0.02, answer = true } = {}) {
    const id = this.nextDnsId++;
    this.udp(client, server, 40000 + id, 53, dnsQuery(id, name));
    if (answer) this.udp(server, client, 53, 40000 + id, dnsResponse(id, name, rcode, answers), { dt: gap });
    return this;
  }

  /** A short TCP exchange: handshake, `rounds` data segments with ACKs; every `retransmitEvery`-th round is sent a second time. */
  tcpFlow(client, server, clientPort, serverPort, { rounds = 5, retransmitEvery = 0, end = null, serverPayload = 200 } = {}) {
    this.tcp(client, server, clientPort, serverPort, Buffer.alloc(0), { flags: 0x02 });
    this.tcp(server, client, serverPort, clientPort, Buffer.alloc(0), { flags: 0x12, dt: 0.08 });
    this.tcp(client, server, clientPort, serverPort, Buffer.alloc(0), { flags: 0x10 });
    for (let i = 0; i < rounds; i++) {
      const segmentSeq = this.sequence.get(`${client}:${clientPort}>${server}:${serverPort}`);
      this.tcp(client, server, clientPort, serverPort, Buffer.alloc(1000));
      this.tcp(server, client, serverPort, clientPort, Buffer.alloc(serverPayload), { dt: 0.02 });
      if (retransmitEvery && i % retransmitEvery === retransmitEvery - 1) {
        this.tcp(client, server, clientPort, serverPort, Buffer.alloc(1000), { seq: segmentSeq, dt: 0.4 });
      }
    }
    if (end === 'fin') this.tcp(client, server, clientPort, serverPort, Buffer.alloc(0), { flags: 0x11 });
    if (end === 'rst') this.tcp(server, client, serverPort, clientPort, Buffer.alloc(0), { flags: 0x04 });
    return this;
  }

  build() {
    const header = Buffer.alloc(24);
    header.writeUInt32LE(0xa1b2c3d4, 0);
    header.writeUInt16LE(2, 4);
    header.writeUInt16LE(4, 6);
    header.writeUInt32LE(65535, 16);
    header.writeUInt32LE(1, 20); // Ethernet
    const parts = [header];
    for (const { time, buffer } of this.packets) {
      const record = Buffer.alloc(16);
      record.writeUInt32LE(Math.floor(time), 0);
      record.writeUInt32LE(Math.round((time % 1) * 1e6), 4);
      record.writeUInt32LE(buffer.length, 8);
      record.writeUInt32LE(buffer.length, 12);
      parts.push(record, buffer);
    }
    return Buffer.concat(parts);
  }
}

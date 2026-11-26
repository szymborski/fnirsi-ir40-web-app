"""BLE sniffer for FNIRSI IR40: scan, find device by name or service EE01, print GATT table, log notifications.

Usage: pip install bleak && python3 dev/sniff.py [seconds]
macOS: the terminal app needs Bluetooth permission (System Settings > Privacy & Security > Bluetooth).
"""
import asyncio, sys, time
from bleak import BleakScanner, BleakClient

DURATION = float(sys.argv[1]) if len(sys.argv) > 1 else 60
SVC = "0000ee01-0000-1000-8000-00805f9b34fb"
RX = "0000ee02-0000-1000-8000-00805f9b34fb"


def hx(b):
    return " ".join(f"{x:02X}" for x in b)


async def main():
    print("scanning 12s...", flush=True)
    found = await BleakScanner.discover(timeout=12, return_adv=True, service_uuids=None)
    target = None
    for d, ad in sorted(found.values(), key=lambda x: -x[1].rssi):
        name = d.name or ad.local_name
        print(f"  {d.address} name={name!r} rssi={ad.rssi} uuids={ad.service_uuids} mfr={ {k: hx(v) for k, v in ad.manufacturer_data.items()} } svcdata={ {k: hx(v) for k, v in ad.service_data.items()} }")
        if (name and "fnirsi" in name.lower()) or SVC in [u.lower() for u in ad.service_uuids]:
            target = d
    if not target:
        print("IR40 not found by name/service")
        return
    print("connecting", target.address, target.name, flush=True)
    async with BleakClient(target) as c:
        print("mtu", c.mtu_size)
        for s in c.services:
            print("svc", s.uuid, s.description)
            for ch in s.characteristics:
                print("   chr", ch.uuid, ch.properties)
        t0 = time.time()

        def cb(_, data):
            print(f"[{time.time()-t0:6.2f}] << ({len(data)}) {hx(data)}", flush=True)

        await c.start_notify(RX, cb)
        print(f"listening {DURATION}s - press buttons on the device", flush=True)
        end = t0 + DURATION
        while time.time() < end and c.is_connected:
            await asyncio.sleep(0.5)
        print("connected at end:", c.is_connected)


asyncio.run(main())

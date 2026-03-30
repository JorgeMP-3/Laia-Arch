import { describe, expect, it } from "vitest";
import { parseObservedNetworkInterfaces } from "./scanner.js";

describe("parseObservedNetworkInterfaces", () => {
  it("parses multiple IPv4 interfaces and marks default routes", () => {
    const interfaces = parseObservedNetworkInterfaces(
      [
        "2: enp0s1    inet 192.168.64.20/24 brd 192.168.64.255 scope global dynamic enp0s1",
        "3: tailscale0    inet 100.70.1.5/32 scope global tailscale0",
        "1: lo    inet 127.0.0.1/8 scope host lo",
      ].join("\n"),
      [
        "default via 192.168.64.1 dev enp0s1 proto dhcp src 192.168.64.20 metric 100",
        "default dev tailscale0 scope link metric 5000",
      ].join("\n"),
    );

    expect(interfaces).toEqual([
      {
        name: "enp0s1",
        ip: "192.168.64.20",
        cidr: "/24",
        gateway: "192.168.64.1",
        isDefaultRoute: true,
      },
      {
        name: "tailscale0",
        ip: "100.70.1.5",
        cidr: "/32",
        gateway: undefined,
        isDefaultRoute: true,
      },
    ]);
  });
});

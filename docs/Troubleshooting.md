# Troubleshooting

Every problem the plugin reports carries a code such as `[SPJ-NET-UNREACHABLE]`. Find the code below.

To capture more detail, turn on **Debug logging** in the plugin settings. Protocol traffic then appears in the Homebridge log (passwords are never logged).
Attach that log when [opening an issue](https://github.com/shivanathd/homebridge-sony-projectors/issues/new/choose).

## SPJ-NET-UNREACHABLE

The plugin could not connect to the projector.

- Check the IP address. Give the projector a DHCP reservation so it does not change.
- Check the projector is plugged in and its network cable is connected.
- On the projector, set **Installation > Remote Start** to **On**, or **Network Management** to **On**. Otherwise it stops listening in standby.
- Check that **ADCP** (current models) or **PJ Talk** (older models) is enabled in the projector's network settings.
- If the projector has a **host address** allow-list, add the Homebridge server's IP.
- Docker: use host networking, or make sure the container can reach the projector's subnet.

While the projector is unreachable, HomeKit shows **No Response**. The plugin keeps retrying, with growing gaps up to one minute, and logs a line when it
responds again.

## SPJ-NET-TIMEOUT

The projector accepted the connection but did not answer in time. Usually the same causes as SPJ-NET-UNREACHABLE. It also happens if another control system
(Crestron, Control4, a second Homebridge) is holding the projector's connection.

## SPJ-NET-CLOSED

The projector closed the connection in the middle of a command. Occasional occurrences are harmless. If it repeats, check for another control system talking
to the projector, and check its host allow-list.

## SPJ-AUTH-REQUIRED

The projector has ADCP authentication turned on, but no password is configured. Enter the projector's web administrator password in the plugin settings.

## SPJ-AUTH-FAILED

The projector rejected the ADCP password. The ADCP password is the projector's **web administrator password** (factory default `Projector`).

After several wrong attempts the projector locks out for about 30 seconds and rejects even the correct password. The plugin waits 30 seconds after an
authentication failure for this reason. If you have just fixed the password, give it a minute.

## SPJ-COMMUNITY

SDCP only. The projector's PJ Talk community is not the one configured. The factory default is `SONY`. Set **SDCP community** in the plugin's advanced settings
to match the projector.

## SPJ-BUSY

The projector cannot do that right now:

- Power commands are refused while it is warming up or cooling down. Cool-down takes about a minute on lamp models.
- Picture settings (input, picture mode, aspect, picture mute) are unavailable in standby, and briefly while the input signal changes.

This is informational. The HomeKit tile is corrected to the projector's real state.

## SPJ-PROTO-REJECTED

The projector refused a value. The value may not exist on this model, or may not apply to the current input signal (some aspect ratios depend on the
signal). Values from the plugin settings are also rejected before sending if they contain anything other than `a-z`, `0-9`, `_` and `.`.

## SPJ-PROTO-UNSUPPORTED

This model does not have the command. The plugin stops offering that feature for the projector. If you think your model should support it, please open an
issue with a debug log.

## SPJ-PROTO-INVALID

The projector sent a reply the plugin did not understand, or the address is not a Sony projector. Check the IP address and the protocol setting, then open an
issue with a debug log.

## SPJ-CONFIG

A setting in the plugin configuration is invalid. The log line names the projector and the setting. The plugin skips or corrects the entry and carries on with
the rest.

## SPJ-ABORTED

A command was cancelled because Homebridge was shutting down or restarting. No action is needed.

## Other questions

**The TV does not appear in the Home app.** TVs are published as separate accessories. Use **Add Accessory > More options** and your Homebridge setup code.

**The projector will not turn on from HomeKit, but turns off fine.** Remote Start or Network Management is off, so the projector is not listening in standby.

**I only want the TV tile.** Leave all feature options at their defaults. No extra accessory is created.

**The Remote shows no buttons for my projector.** SDCP projectors do not accept remote-key commands. Use ADCP if the projector supports it.

/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const sampleInterval = 0.1;
const maxSampleHistory = 10; // 0.1 * 10 = 1s of history
const minSpeed = 1024; // 1 KiB/s to bother showing anything
const speedUnits = [
    "B/s", "KiB/s", "MiB/s", "GiB/s", "TiB/s", "PiB/s", "EiB/s", "ZiB/s", "YiB/s"
];
let lastTotalDownBytes = 0;
let lastTotalUpBytes = 0;
let speedHistory = new Array();

const getCurrentNetSpeed = (refreshInterval) => {
    const ByteArray = new TextDecoder(('utf-8'));
    const averageSpeed = {"down": 0, "up": 0};

    try {
        const inputFile = Gio.File.new_for_path("/proc/net/dev");
        const [, content] = inputFile.load_contents(null);
        const lines = ByteArray.decode(content).split('\n');

        // Caculate the sum of all interfaces' traffic line by line.
        let totalDownBytes = 0;
        let totalUpBytes = 0;

        for (const element of lines) {
            const fields = element.trim().split(/\W+/);
            if (fields.length <= 2) {
                continue;
            }

            // Skip virtual interfaces.
            const interfaceName = fields[0];
            const currentInterfaceDownBytes = Number.parseInt(fields[1]);
            const currentInterfaceUpBytes = Number.parseInt(fields[9]);
            if (interfaceName === "lo" ||
                RegExp(/^ifb\d+/).exec(interfaceName) ||
                RegExp(/^lxdbr\d+/).exec(interfaceName) ||
                RegExp(/^virbr\d+/).exec(interfaceName) ||
                RegExp(/^br\d+/).exec(interfaceName) ||
                RegExp(/^vnet\d+/).exec(interfaceName) ||
                RegExp(/^tun\d+/).exec(interfaceName) ||
                RegExp(/^tap\d+/).exec(interfaceName) ||
                isNaN(currentInterfaceDownBytes) ||
                isNaN(currentInterfaceUpBytes)) {
                continue;
            }

            totalDownBytes += currentInterfaceDownBytes;
            totalUpBytes += currentInterfaceUpBytes;
        }

        if (lastTotalDownBytes === 0) {
            lastTotalDownBytes = totalDownBytes;
        }
        
        if (lastTotalUpBytes === 0) {
            lastTotalUpBytes = totalUpBytes;
        }

        const speed = {"down": 0, "up": 0};
        speed["down"] = (totalDownBytes - lastTotalDownBytes) / sampleInterval;
        speed["up"] = (totalUpBytes - lastTotalUpBytes) / sampleInterval;

        lastTotalDownBytes = totalDownBytes;
        lastTotalUpBytes = totalUpBytes;

        if (speedHistory.length >= maxSampleHistory) {
            speedHistory.pop();
        }
        
        speedHistory.push(speed);
        speedHistory.reduce((accumulator, value) => {
            accumulator["down"] += value;
            accumulator["up"] += value;
        }, averageSpeed);

        averageSpeed["down"] /= speedHistory.length;
        averageSpeed["up"] /= speedHistory.length;
    } catch (e) {
        logError(e);
    }

    return averageSpeed;
};

const formatSpeedWithUnit = (amount) => {
    let unitIndex = 0;
    while (amount >= 1024 && unitIndex < speedUnits.length - 1) {
        amount /= 1024;
        ++unitIndex;
    }

    return `${amount.toFixed(0)} ${speedUnits[unitIndex]}`;
};

const toSpeedString = (speed) => {
    if (speed["down"] < minSpeed && speed["up"] < minSpeed) {
        return '-';
    } 
    
    if (speed["down"] < minSpeed) {
        return `↑ ${formatSpeedWithUnit(speed["up"])}`;
    } 
    
    if (speed["up"] < minSpeed) {
        return `↓ ${formatSpeedWithUnit(speed["down"])}`;
    }
    
    return `↓ ${formatSpeedWithUnit(speed["down"])} ↑ ${formatSpeedWithUnit(speed["up"])}`;
};

const NetLabel = GObject.registerClass(
class NetLabel extends PanelMenu.Button {
    _init() {
        super._init(0.0, _('netLabel',true));

        this._label = new St.Label({
            "y_align": Clutter.ActorAlign.CENTER,
            "text": "-"
        });

        this.add_child(this._label);
    }

    setLabelText(text) {
        return this._label.set_text(text);
    }
});



export default class NetLabelExtension extends Extension {
    enable() {
        lastTotalDownBytes = 0;
        lastTotalUpBytes = 0;
        speedHistory = new Array();

        this._indicator = new NetLabel();
        Main.panel.addToStatusArea(this.uuid, this._indicator, 1, 'right');

        this._timeout = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, sampleInterval, () => {
                const speed = getCurrentNetSpeed(refreshInterval);
                const text = toSpeedString(speed);
                this._indicator.setLabelText(text);

                return GLib.SOURCE_CONTINUE;
            }
        )
    }

    disable() {
        if (this._indicator != null) {
            this._indicator.destroy();
            this._indicator = null;
        }
        if (this._timeout != null) {
            GLib.source_remove(this._timeout);
            this._timeout = null;
        }
    }
}

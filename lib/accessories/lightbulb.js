/**
 * FritzLightbulbAccessory
 *
 * @url https://github.com/glowf1sh/homebridge-fritz-new
 * @original author Andreas Götz
 * @new author Glowf1sh <https://twitch.tv/glowf1sh>
 * @license MIT
 */

/* jslint node: true, laxcomma: true, esversion: 8 */
"use strict";

let Service, Characteristic, FritzAccessory;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    FritzAccessory = require('../accessory')(homebridge);

    class FritzLightbulbAccessory extends FritzAccessory {
        constructor(platform, ain, type, device) {
            super(platform, ain, type, device);

            if (device) {
                this.accessory = device;
                this.accessory.context.ain = ain;
                this.accessory.context.type = type;
            } else {
                const name = this.name;
                const uuid = this.platform.api.hap.uuid.generate(ain);
                this.accessory = new this.platform.api.platformAccessory(name, uuid);
                this.accessory.context.ain = ain;
                this.accessory.context.type = type;
            }

            this.platformAccessory = this.accessory;

            if (!this.platformAccessory.getService(Service.AccessoryInformation)) {
                this.platformAccessory.addService(Service.AccessoryInformation);
            }

            const infoService = this.platformAccessory.getService(Service.AccessoryInformation);
            infoService.setCharacteristic(Characteristic.SerialNumber, this.ain);

            if (this.device.manufacturer) {
                infoService.setCharacteristic(Characteristic.Manufacturer, this.device.manufacturer);
            }
            if (this.device.productname) {
                infoService.setCharacteristic(Characteristic.Model, this.device.productname);
            }
            if (this.device.fwversion) {
                infoService.setCharacteristic(Characteristic.FirmwareRevision, this.device.fwversion);
            }

            let lightService = this.platformAccessory.getService(Service.Lightbulb);
            if (!lightService) {
                lightService = this.platformAccessory.addService(Service.Lightbulb, this.name);
            }

            lightService.getCharacteristic(Characteristic.On)
                .on('get', this.getOn.bind(this))
                .on('set', this.setOn.bind(this));

            if (this.hasBrightnessSupport()) {
                lightService.getCharacteristic(Characteristic.Brightness)
                    .on('get', this.getBrightness.bind(this))
                    .on('set', this.setBrightness.bind(this));
            }

            this.services = {
                AccessoryInformation: infoService,
                Lightbulb: lightService
            };

            this.services.Lightbulb.fritzState = this.getDeviceState(this.device);
            this.services.Lightbulb.fritzBrightness = this.getDeviceBrightness(this.device);

            this.update(this.device);
        }

        getServices() {
            return [];
        }

        hasBrightnessSupport() {
            const features = this.accessory.context.features || {};
            return features.hasLevelControl || features.hasDimmer || !!(this.device && this.device.levelcontrol);
        }

        getDeviceState(device) {
            if (!device) {
                return false;
            }

            if (typeof device.state === 'boolean') {
                return device.state;
            }

            if (device.simpleonoff && typeof device.simpleonoff.state === 'boolean') {
                return device.simpleonoff.state;
            }

            if (device.switch && typeof device.switch.state === 'boolean') {
                return device.switch.state;
            }

            return false;
        }

        getDeviceBrightness(device) {
            if (!device) {
                return 100;
            }

            if (device.values && device.values.levelcontrol && device.values.levelcontrol.levelpercentage !== null && device.values.levelcontrol.levelpercentage !== undefined) {
                return device.values.levelcontrol.levelpercentage;
            }

            if (device.levelcontrol && device.levelcontrol.levelpercentage !== undefined) {
                return parseInt(device.levelcontrol.levelpercentage) || 0;
            }

            return this.getDeviceState(device) ? 100 : 0;
        }

        getOn(callback) {
            callback(null, this.services.Lightbulb.fritzState);
            this.queryState();
        }

        async setOn(state, callback) {
            this.platform.log(`Switching ${this.name} (${this.ain}) to ${state ? 'ON' : 'OFF'}`);
            callback(null);

            try {
                await this.platform.fritz('setSimpleOnOff', this.ain, state ? 1 : 0, { priority: 10 });

                this.services.Lightbulb.fritzState = state;
                this.services.Lightbulb.getCharacteristic(Characteristic.On).updateValue(state);

                if (this.hasBrightnessSupport() && state && this.services.Lightbulb.fritzBrightness === 0) {
                    this.services.Lightbulb.fritzBrightness = 100;
                    this.services.Lightbulb.getCharacteristic(Characteristic.Brightness).updateValue(100);
                }
            } catch (error) {
                this.platform.log.error(`Failed to switch ${this.name}:`, error);
                this.services.Lightbulb.getCharacteristic(Characteristic.On).updateValue(!state);
            }
        }

        getBrightness(callback) {
            callback(null, this.services.Lightbulb.fritzBrightness);
            this.queryState();
        }

        async setBrightness(brightness, callback) {
            callback(null);

            const targetBrightness = Math.max(0, Math.min(100, Math.round(brightness)));

            try {
                await this.platform.fritz('setLevelPercentage', this.ain, targetBrightness, { priority: 10 });

                this.services.Lightbulb.fritzBrightness = targetBrightness;
                this.services.Lightbulb.getCharacteristic(Characteristic.Brightness).updateValue(targetBrightness);

                const targetState = targetBrightness > 0;
                this.services.Lightbulb.fritzState = targetState;
                this.services.Lightbulb.getCharacteristic(Characteristic.On).updateValue(targetState);
            } catch (error) {
                this.platform.log.error(`Failed to set brightness for ${this.name}:`, error);
                this.queryState();
            }
        }

        queryState() {
            return this.platform.fritz('getDeviceInfos', this.ain).then(device => {
                this.update(device);
            }).catch(error => {
                this.platform.log.debug(`Failed to query light state for ${this.ain}:`, error.message);
            });
        }

        update(device) {
            if (device) {
                this.device = device;
                this.accessory.context.features = device.features || this.accessory.context.features || {};
            }

            const state = this.getDeviceState(this.device);
            const brightness = this.getDeviceBrightness(this.device);

            this.services.Lightbulb.fritzState = state;
            this.services.Lightbulb.getCharacteristic(Characteristic.On).updateValue(state);

            if (this.hasBrightnessSupport()) {
                this.services.Lightbulb.fritzBrightness = brightness;
                this.services.Lightbulb.getCharacteristic(Characteristic.Brightness).updateValue(brightness);
            }
        }

        cleanup() {
        }
    }

    return FritzLightbulbAccessory;
};
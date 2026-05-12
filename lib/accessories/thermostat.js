/**
 * FritzThermostatAccessory
 *
 * @url https://github.com/glowf1sh/homebridge-fritz-new
 * @original author Andreas Götz
 * @new author Glowf1sh <https://twitch.tv/glowf1sh>
 * @license MIT
 */

/* jslint node: true, laxcomma: true, esversion: 8 */
"use strict";

const { parseBatteryLevel } = require('../utils');

let Service, Characteristic, FritzPlatform, FritzAccessory;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    FritzPlatform = require('../platform')(homebridge);
    FritzAccessory = require('../accessory')(homebridge);

    class FritzThermostatAccessory extends FritzAccessory {
        constructor(platform, ain, type, device) {
            super(platform, ain, type, device);
            
            if (device) {
                // Existing accessory from cache
                this.accessory = device;
                this.accessory.context.ain = ain;
                this.accessory.context.type = type;
            } else {
                // New accessory
                const name = this.name;
                const uuid = this.platform.api.hap.uuid.generate(ain);
                this.accessory = new this.platform.api.platformAccessory(name, uuid);
                this.accessory.context.ain = ain;
                this.accessory.context.type = type;
            }

            // Setup AccessoryInformation service
            if (!this.accessory.getService(Service.AccessoryInformation)) {
                this.accessory.addService(Service.AccessoryInformation);
            }
            
            const infoService = this.accessory.getService(Service.AccessoryInformation);
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

            // Setup Thermostat service
            let thermostatService = this.accessory.getService(Service.Thermostat);
            if (!thermostatService) {
                thermostatService = this.accessory.addService(Service.Thermostat, this.name);
            }

            // Thermostat characteristics
            thermostatService.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
                .setProps({validValues: [0, 1]})
                .onGet(async () => {
                    try {
                        return await this.getCurrentHeatingCoolingState();
                    } catch (error) {
                        this.platform.log.error(`[${this.name}] Failed to get current heating cooling state:`, error);
                        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                    }
                });
            
            thermostatService.getCharacteristic(Characteristic.TargetHeatingCoolingState)
                .setProps({validValues: [0, 1]}) // only support "off" and "heating"
                .onGet(async () => {
                    try {
                        return await this.getTargetHeatingCoolingState();
                    } catch (error) {
                        this.platform.log.error(`[${this.name}] Failed to get target heating cooling state:`, error);
                        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                    }
                })
                .onSet(async (state, callback) => {
                    // Immediately respond to HomeKit to prevent timeout
                    if (callback) callback();
                    
                    try {
                        await this.setTargetHeatingCoolingState(state);
                    } catch (error) {
                        this.platform.log.error(`[${this.name}] Failed to set target heating cooling state:`, error);
                        // Don't throw - we already called callback
                    }
                });
            
            thermostatService.getCharacteristic(Characteristic.CurrentTemperature)
                .setProps({minValue: -50})
                .onGet(async () => {
                    try {
                        return await this.getCurrentTemperature();
                    } catch (error) {
                        this.platform.log.error(`[${this.name}] Failed to get current temperature:`, error);
                        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                    }
                });
            
            thermostatService.getCharacteristic(Characteristic.TargetTemperature)
                .setProps({validValueRanges: [8, 28], minValue: 8, maxValue: 28}) // supported temperature range of fritz thermostat
                .onGet(async () => {
                    try {
                        return await this.getTargetTemperature();
                    } catch (error) {
                        this.platform.log.error(`[${this.name}] Failed to get target temperature:`, error);
                        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                    }
                })
                .onSet(async (temperature, callback) => {
                    // Immediately respond to HomeKit to prevent timeout
                    if (callback) callback();
                    
                    try {
                        await this.setTargetTemperature(temperature);
                    } catch (error) {
                        this.platform.log.error(`[${this.name}] Failed to set target temperature:`, error);
                        // Don't throw - we already called callback
                    }
                });
            
            thermostatService.getCharacteristic(Characteristic.TemperatureDisplayUnits)
                .onGet(async () => {
                    try {
                        return await this.getTemperatureDisplayUnits();
                    } catch (error) {
                        this.platform.log.error(`[${this.name}] Failed to get temperature display units:`, error);
                        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                    }
                });
            
            // Add StatusActive for better visibility (this is officially supported)
            if (!thermostatService.testCharacteristic(Characteristic.StatusActive)) {
                thermostatService.addCharacteristic(Characteristic.StatusActive);
            }
            thermostatService.getCharacteristic(Characteristic.StatusActive)
                .updateValue(true);

            // Setup BatteryService
            const BatteryService = Service.BatteryService || Service.Battery;
            let batteryService = null;

            if (BatteryService) {
                batteryService = this.accessory.getService(BatteryService);
                if (!batteryService) {
                    this.platform.log.info(`[${this.name}] Adding BatteryService`);
                    batteryService = this.accessory.addService(BatteryService, this.name);
                } else {
                    this.platform.log.info(`[${this.name}] BatteryService already exists`);
                }
            } else {
                this.platform.log.info(`[${this.name}] BatteryService already exists`);
            }

            // BatteryService characteristics
            if (batteryService) {
                batteryService.getCharacteristic(Characteristic.BatteryLevel)
                    .onGet(async () => {
                        try {
                            return await this.getBatteryLevel();
                        } catch (error) {
                            this.platform.log.error(`[${this.name}] Failed to get battery level:`, error);
                            throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                        }
                    });
                
                batteryService.getCharacteristic(Characteristic.ChargingState)
                    .onGet(async () => {
                        try {
                            return await this.getChargingState();
                        } catch (error) {
                            this.platform.log.error(`[${this.name}] Failed to get charging state:`, error);
                            throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                        }
                    });
                
                batteryService.getCharacteristic(Characteristic.StatusLowBattery)
                    .onGet(async () => {
                        try {
                            return await this.getStatusLowBattery();
                        } catch (error) {
                            this.platform.log.error(`[${this.name}] Failed to get low battery status:`, error);
                            throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
                        }
                    });
            }

            // Store references to services for quick access
            this.services = {
                AccessoryInformation: infoService,
                Thermostat: thermostatService,
                BatteryService: batteryService
            };

            // Initialize state
            this.services.Thermostat.fritzCurrentTemperature = 20;
            if (this.services.BatteryService) {
                this.services.BatteryService.fritzBatteryLevel = 100;
                this.services.BatteryService.fritzStatusLowBattery = Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
            }
            this.services.Thermostat.fritzCurrentHeatingCoolingState = Characteristic.CurrentHeatingCoolingState.OFF;
            this.services.Thermostat.fritzTargetHeatingCoolingState = Characteristic.TargetHeatingCoolingState.OFF;
            this.services.Thermostat.fritzTargetTemperature = 20;
            
            // Store last active temperature for OFF mode
            this.lastActiveTargetTemperature = 20;
            
            // WICHTIG: Initial values für HomeKit setzen, sonst wird der Service nicht angezeigt!
            if (batteryService) {
                batteryService.getCharacteristic(Characteristic.BatteryLevel).updateValue(100);
                batteryService.getCharacteristic(Characteristic.StatusLowBattery).updateValue(Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
            }

            this.pollInterval = this.platform.interval;
            this.startPolling();
            
            // Initial battery query after short delay
            setTimeout(() => {
                this.platform.log.debug(`[${this.name}] Initial battery query`);
                // Nur wenn device vorhanden (von updateAccessoryServices)
                if (this.device && this.device.battery !== undefined) {
                    this.queryBatteryLevel();
                    this.platform.log.debug(`[${this.name}] Battery aus XML: ${this.device.battery}%`);
                } else {
                    this.platform.log.debug(`[${this.name}] Warte auf device update für Batterie`);
                }
            }, 2000);
            
            // Mark as not offline initially (we don't know yet)
            this.isOffline = false;
        }

        // Override getServices to work with dynamic platform
        getServices() {
            // Not needed for dynamic platform - services are managed by PlatformAccessory
            return [];
        }

    async getCurrentHeatingCoolingState() {
        this.platform.log.debug(`Getting ${this.type} ${this.ain} current heating state`);

        // current state gets queried in getTargetTemperature
        return this.services.Thermostat.fritzCurrentHeatingCoolingState;
    }

    async getTargetHeatingCoolingState() {
        this.platform.log.debug(`Getting ${this.type} ${this.ain} target heating state`);

        // target state gets queried in getTargetTemperature
        return this.services.Thermostat.fritzTargetHeatingCoolingState;
    }

    async setTargetHeatingCoolingState(state) {
        this.platform.log.debug(`Setting ${this.type} ${this.ain} heating state`);

        const service = this.services.Thermostat;

        service.fritzTargetHeatingCoolingState = state;

        let currentState;
        if (state === Characteristic.TargetHeatingCoolingState.OFF) {
            await this.platform.fritz("setTempTarget", this.ain, "off", { priority: 10 });
            currentState = Characteristic.CurrentHeatingCoolingState.OFF;
        } else if (state === Characteristic.TargetHeatingCoolingState.HEAT) {
            // When turning ON, use last active temperature
            const tempToSet = this.lastActiveTargetTemperature || service.fritzTargetTemperature;
            await this.platform.fritz("setTempTarget", this.ain, tempToSet, { priority: 10 });
            service.fritzTargetTemperature = tempToSet;
            currentState = this.calculateCurrentHeatingCoolingState();
        }

        service.fritzCurrentHeatingCoolingState = currentState;
        service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(currentState);
        
        // Query the actual state after a short delay
        setTimeout(() => {
            this.queryTargetTemperature();
        }, 1000);
    }

    async getTargetTemperature() {
        this.platform.log.debug(`Getting ${this.type} ${this.ain} target temperature`);

        // Return cached value immediately without querying
        // This prevents overwriting values that were just set
        return this.services.Thermostat.fritzTargetTemperature;
    }

    async setTargetTemperature(temperature) {
        this.platform.log.info(`Setting ${this.type} ${this.ain} target temperature to ${temperature}°C`);

        const service = this.services.Thermostat;

        // Update local state immediately for responsive UI
        service.fritzTargetTemperature = temperature;
        this.lastActiveTargetTemperature = temperature; // Store as last active temperature
        service.fritzTargetHeatingCoolingState = Characteristic.TargetHeatingCoolingState.HEAT;
        service.fritzCurrentHeatingCoolingState = this.calculateCurrentHeatingCoolingState();

        service.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(service.fritzTargetHeatingCoolingState);
        service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(service.fritzCurrentHeatingCoolingState);

        // Send command immediately without debouncing
        try {
            await this.platform.fritz('setTempTarget', this.ain, temperature, { priority: 10 });
            this.platform.log.debug(`Successfully set ${this.name} to ${temperature}°C`);
            
            // Immediately update the value in HomeKit to prevent UI jumping
            service.getCharacteristic(Characteristic.TargetTemperature).updateValue(temperature);
            
            // Query the actual value after a short delay
            setTimeout(() => {
                this.queryTargetTemperature();
            }, 2000);
        } catch (error) {
            this.platform.log.error(`Failed to set temperature for ${this.name}: ${error.message}`);
            // Log more details if debug is enabled
            if (this.platform.config.debug && error.response) {
                this.platform.log.debug(`Error details: Status=${error.response.status}, Data=${error.response.data}`);
            }
            // Revert the temperature on error
            service.getCharacteristic(Characteristic.TargetTemperature).updateValue(service.fritzTargetTemperature);
        }
    }

    async getTemperatureDisplayUnits() {
        return Characteristic.TemperatureDisplayUnits.CELSIUS;
    }

    queryTargetTemperature() {
    this.platform.fritz('getTempTarget', this.ain).then(temperature => {
        const service = this.services.Thermostat;
        
        // Handle null/undefined responses (offline devices)
        if (temperature === null || temperature === undefined) {
            this.platform.log.debug(`[${this.name}] Device offline or not responding, keeping last known values`);
            return; // Don't update anything, keep last known values
        }

        let targetTemperature = temperature;
        let currentHeatingCoolingState;
        let targetHeatingCoolingState = Characteristic.TargetHeatingCoolingState.HEAT;

        if (temperature === "on") { // change to hap representable value if thermostat is set to on permanently
            targetTemperature = service.getCharacteristic(Characteristic.TargetTemperature).props.maxValue;
        }

        if (temperature === "off") {
            // Don't update temperature value when OFF
            // Just update the heating states
            currentHeatingCoolingState = Characteristic.CurrentHeatingCoolingState.OFF;
            targetHeatingCoolingState = Characteristic.TargetHeatingCoolingState.OFF;
            // Return early without updating temperature
            service.fritzCurrentHeatingCoolingState = currentHeatingCoolingState;
            service.fritzTargetHeatingCoolingState = targetHeatingCoolingState;
            service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(currentHeatingCoolingState);
            service.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(targetHeatingCoolingState);
            return;
        } else {
            currentHeatingCoolingState = this.calculateCurrentHeatingCoolingState();
        }

        service.fritzTargetTemperature = targetTemperature;
        service.fritzCurrentHeatingCoolingState = currentHeatingCoolingState;
        service.fritzTargetHeatingCoolingState = targetHeatingCoolingState;

        service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(currentHeatingCoolingState);
        service.getCharacteristic(Characteristic.TargetHeatingCoolingState).updateValue(targetHeatingCoolingState);
        service.getCharacteristic(Characteristic.TargetTemperature).updateValue(targetTemperature);
    }).catch(error => {
        this.platform.log.debug(`Error getting target temperature for ${this.ain}:`, error.message);
        // Keep using last known values on error
    });
    }

    calculateCurrentHeatingCoolingState() {
        const service = this.services.Thermostat;
        
        // Check for window open state first (highest priority)
        if (this.device && this.device.hkr && this.device.hkr.windowopenactive) {
            this.platform.log.debug(`[${this.name}] Window open detected, thermostat is OFF`);
            return Characteristic.CurrentHeatingCoolingState.OFF;
        }
        
        // Check if thermostat is set to OFF (tsoll <= 8°C)
        if (service.fritzTargetTemperature <= 8) {
            return Characteristic.CurrentHeatingCoolingState.OFF;
        }
        
        // Check for boost mode
        if (this.device && this.device.hkr && this.device.hkr.boostactive) {
            this.platform.log.debug(`[${this.name}] Boost mode active, thermostat is HEATING`);
            return Characteristic.CurrentHeatingCoolingState.HEAT;
        }
        
        // Normal operation: compare current vs target temperature
        const currentTemperature = service.fritzCurrentTemperature;
        return currentTemperature <= service.fritzTargetTemperature ? 
            Characteristic.CurrentHeatingCoolingState.HEAT : 
            Characteristic.CurrentHeatingCoolingState.OFF;
    }

    async getBatteryLevel() {
        this.platform.log.debug(`Getting ${this.type} ${this.ain} battery level`);

        const service = this.services.BatteryService;
        return service.fritzBatteryLevel;
    }

    async getChargingState() {
        return Characteristic.ChargingState.NOT_CHARGEABLE;
    }

    async getStatusLowBattery() {
        this.platform.log.debug(`Getting ${this.type} ${this.ain} battery status`);

        const service = this.services.BatteryService;
        return service.fritzStatusLowBattery;
    }

    async getCurrentTemperature() {
        this.platform.log.debug(`Getting ${this.type} ${this.ain} temperature`);
        
        // Don't check offline status if we don't have device data yet
        // This prevents false offline detection at startup
        
        // characteristic CurrentTemperature is part of multiple services
        const service = this.services.Thermostat || this.services.TemperatureSensor;
        return service.fritzCurrentTemperature || 20; // Return default if not yet initialized
    }

    queryBatteryLevel() {
        // Thermostate unterstützen getBatteryCharge NICHT!
        // Batterie-Info kommt aus XML (device.battery)
        const service = this.services.BatteryService;
        
        // Nur wenn device vorhanden ist
        if (!this.device) {
            this.platform.log.debug(`[${this.name}] Kein device Objekt für Batterie-Abfrage`);
            return;
        }
        
        // Batterie aus XML-Cache
        let validBatteryLevel = 100; // Default
        
        if (this.device.battery !== undefined) {
            validBatteryLevel = parseInt(this.device.battery) || 100;
        } else {
            this.platform.log.debug(`[${this.name}] Kein battery Tag in XML`);
            return;
        }
        
        service.fritzBatteryLevel = validBatteryLevel;
        
        const isLow = validBatteryLevel < 20;
        const isCritical = validBatteryLevel <= 5;
        
        // Nutze auch batterylow flag aus XML
        const batteryLowFlag = this.device.batterylow === '1';
        
        service.fritzStatusLowBattery = (isLow || batteryLowFlag) 
            ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW 
            : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;

        // update internal value; event get only sent when value changes
        service.getCharacteristic(Characteristic.BatteryLevel).updateValue(service.fritzBatteryLevel);
        service.getCharacteristic(Characteristic.StatusLowBattery).updateValue(service.fritzStatusLowBattery);
        
        // Log battery warnings only if value changed significantly
        const lastBatteryLevel = service.lastLoggedBatteryLevel;
        const isFirstCheck = lastBatteryLevel === undefined;
        const shouldLog = isFirstCheck || // Always log on first check
                         Math.abs(validBatteryLevel - lastBatteryLevel) >= 5 || // Log if changed by 5% or more
                         (isCritical && lastBatteryLevel > 5) || // Log if just became critical
                         (isLow && lastBatteryLevel >= 20); // Log if just became low
        
        if (shouldLog) {
            service.lastLoggedBatteryLevel = validBatteryLevel;
            
            // Only log warnings for low/critical battery
            if (isCritical) {
                this.platform.log.error(`[${this.name}] KRITISCH: Batterie nur noch ${validBatteryLevel}%! Sofort wechseln!`);
                
                // Also update StatusActive when battery is critical - show as inactive
                const thermostatService = this.accessory.getService(Service.Thermostat);
                if (thermostatService) {
                    const statusActive = thermostatService.getCharacteristic(Characteristic.StatusActive);
                    if (statusActive) {
                        statusActive.updateValue(false); // Show as inactive when critical
                    }
                }
            } else if (isLow) {
                this.platform.log.warn(`[${this.name}] Batterie niedrig: ${validBatteryLevel}%`);
            } else if (isFirstCheck && validBatteryLevel >= 80) {
                // Only log good battery on first check if it's high
                this.platform.log.debug(`[${this.name}] Batterie OK: ${validBatteryLevel}%`);
            }
        }
    }

    update(device) {
        this.platform.log.debug(`Updating ${this.type} ${this.ain}`);
        
        // Update device data if provided
        if (device) {
            this.device = device;
            
            // Check if device is offline
            const isOffline = device.present !== '1';
            const wasOffline = this.isOffline || false;
            this.isOffline = isOffline;
            
            const thermostatService = this.accessory.getService(Service.Thermostat);
            
            // Update StatusActive based on offline status
            if (thermostatService) {
                const statusActive = thermostatService.getCharacteristic(Characteristic.StatusActive);
                if (statusActive) {
                    statusActive.updateValue(!isOffline);
                }
            }
            
            // Log offline status changes only on state change
            if (isOffline && !wasOffline) {
                this.platform.log.warn(`[${this.name}] Device went OFFLINE!`);
            } else if (!isOffline && wasOffline) {
                this.platform.log.info(`[${this.name}] Device is back ONLINE!`);
            }
            
            // Update heating state based on new device data
            const service = this.services.Thermostat;
            const newState = this.calculateCurrentHeatingCoolingState();
            if (service.fritzCurrentHeatingCoolingState !== newState) {
                service.fritzCurrentHeatingCoolingState = newState;
                service.getCharacteristic(Characteristic.CurrentHeatingCoolingState).updateValue(newState);
            }
            
            // Only query device if online
            if (!isOffline) {
                this.queryCurrentTemperature();
                this.queryTargetTemperature();
            } else {
                // Set temperature to null or error value when offline
                this.platform.log.warn(`[${this.name}] Skipping temperature queries - device is offline`);
            }
            
            // Always update battery status
            this.queryBatteryLevel();
        } else {
            // No device data provided, do normal queries
            this.queryCurrentTemperature();
            this.queryTargetTemperature();
            this.queryBatteryLevel();
        }
    }

    startPolling() {
        const poll = async () => {
            await this.update();
            this.pollTimeout = setTimeout(poll, this.pollInterval);
        };

        poll();
    }

    cleanup() {
        if (this.pollTimeout) {
            clearTimeout(this.pollTimeout);
            this.pollTimeout = null;
        }
    }
}

    return FritzThermostatAccessory;
};
/**
 * FritzPlatform - Dynamic Platform Implementation
 *
 * @url https://github.com/glowf1sh/homebridge-fritz-new
 * @original author Andreas Götz
 * @new author Glowf1sh <https://twitch.tv/glowf1sh>
 * @license MIT
 */

/* jslint node: true, laxcomma: true, esversion: 6 */
"use strict";

const get = require('lodash.get');
const fritz = require('./fritz-api');
const isWebUri = require('valid-url').isWebUri;
const { inherits } = require('util');
const { default: PQueue } = require('p-queue');
let Characteristic, Homebridge, PlatformAccessory;

module.exports = function(homebridge) {
    Homebridge = homebridge;
    Characteristic = homebridge.hap.Characteristic;
    PlatformAccessory = homebridge.platformAccessory;

    // Define custom characteristics before inheriting
    FritzPlatform.PowerUsage = function() {
        if (Characteristic && Characteristic.call) {
            Characteristic.call(this, 'Power Usage', 'AE48F447-E065-4B31-8050-8FB06DB9E087');

            this.setProps({
                format: Characteristic.Formats.FLOAT,
                unit: 'W',
                perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
            });

            this.value = this.getDefaultValue();
        }
    };

    FritzPlatform.EnergyConsumption = function() {
        if (Characteristic && Characteristic.call) {
            Characteristic.call(this, 'Energy Consumption', 'C4805C5B-45B7-4E5B-BFCB-FE43E0FBC1E5');

            this.setProps({
                format: Characteristic.Formats.FLOAT,
                unit: 'kWh',
                perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
            });

            this.value = this.getDefaultValue();
        }
    };
    
    FritzPlatform.Voltage = function() {
        if (Characteristic && Characteristic.call) {
            Characteristic.call(this, 'Voltage', 'E863F10A-079E-48FF-8F27-9C2605A29F52');

            this.setProps({
                format: Characteristic.Formats.FLOAT,
                unit: 'V',
                minValue: 0,
                maxValue: 400,
                minStep: 0.1,
                perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
            });

            this.value = this.getDefaultValue();
        }
    };

    // Only inherit if Characteristic is properly initialized
    if (Characteristic && Characteristic.prototype) {
        inherits(FritzPlatform.PowerUsage, Characteristic);
        inherits(FritzPlatform.EnergyConsumption, Characteristic);
        inherits(FritzPlatform.Voltage, Characteristic);
        
        // Add UUID as static property for easy access
        FritzPlatform.PowerUsage.UUID = 'AE48F447-E065-4B31-8050-8FB06DB9E087';
        FritzPlatform.EnergyConsumption.UUID = 'C4805C5B-45B7-4E5B-BFCB-FE43E0FBC1E5';
        FritzPlatform.Voltage.UUID = 'E863F10A-079E-48FF-8F27-9C2605A29F52';
    }

    return FritzPlatform;
};

function FritzPlatform(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    
    // Log version information on startup
    const packageInfo = require('../package.json');
    this.log("[FritzBox] homebridge-fritz-new v" + packageInfo.version + " starting up");

    // Validate configuration
    if (!config) {
        throw new Error('Missing configuration');
    }

    // Validate credentials
    if (!config.username || !config.password) {
        throw new Error('Username and password are required in configuration');
    }

    this.options = this.config.options || {};
    this.options.log = log; // Pass log to fritz API calls
    
    // Set timeout from config, default to 15000ms (15 seconds)
    this.options.timeout = this.config.timeout || 15000;
    this.interval = 1000 * (this.config.interval || 60);  // 1 minute - legacy
    
    // Default polling intervals (can be overridden in config)
    const defaultIntervals = {
        discovery: 300000,    // 5 minutes for device discovery
        switchStates: 3000,   // 3 seconds for switch states
        sensorData: 10000,    // 10 seconds for sensor data
        batteryStatus: 900000 // 15 minutes for battery status
    };
    
    // Get user-defined intervals from config
    const userIntervals = this.config.polling || {};
    
    // Build intervals object with validation - only process known keys
    const intervals = {};
    const minimumInterval = 1000; // 1 second minimum
    
    // Only process keys that we expect (from defaultIntervals)
    for (const key of Object.keys(defaultIntervals)) {
        const userValue = userIntervals[key];
        const defaultValue = defaultIntervals[key];
        
        if (userValue !== undefined) {
            // User provided a value, validate it
            if (typeof userValue === 'number' && userValue >= minimumInterval) {
                intervals[key] = userValue;
            } else {
                this.log.warn(`[FritzBox] Polling interval for '${key}' is invalid or too low (${userValue}ms). Using default value of ${defaultValue}ms.`);
                intervals[key] = defaultValue;
            }
        } else {
            // Use default value
            intervals[key] = defaultValue;
        }
    }
    
    // Optionally log ignored keys (like _comment)
    for (const key in userIntervals) {
        if (!defaultIntervals.hasOwnProperty(key)) {
            this.log.debug(`[FritzBox] Ignoring unknown key '${key}' in 'polling' configuration.`);
        }
    }
    
    // Log final intervals for transparency
    this.log.info(`[FritzBox] Polling intervals (ms): discovery=${intervals.discovery}, switchStates=${intervals.switchStates}, sensorData=${intervals.sensorData}, batteryStatus=${intervals.batteryStatus}`);
    
    // Set the validated intervals
    this.discoveryInterval = intervals.discovery;
    this.statePollingInterval = intervals.switchStates;
    this.sensorPollingInterval = intervals.sensorData;
    this.batteryPollingInterval = intervals.batteryStatus;

    this.pending = 0; // pending requests

    // device configuration
    this.config.devices = this.config.devices || {};

    // fritz url
    const url = this.config.url || 'http://fritz.box';
    if (!isWebUri(url)) {
        throw new Error("Invalid FRITZ!Box url - must start with http:// or https://");
    }
    // trailing slash
    if (url.substr(-1) == "/") url = url.slice(0, -1);
    this.options.url = url;

    this.promise = null;

    // Dynamic platform properties
    this.accessories = []; // Array to store restored accessories
    this.deviceList = []; // Current device list from Fritz!Box
    this.accessoryInstances = new Map(); // Map to store accessory instances for cleanup
    
    // Request queue to prevent overwhelming the Fritz!Box
    this.requestQueue = new PQueue({ 
        concurrency: 1,  // Only 1 request at a time
        interval: 50,    // Reduced from 200ms to 50ms for faster response
        intervalCap: 1   // Allow 1 request per interval
    });
    
    // Polling statistics
    this.pollingStats = {
        switches: { success: 0, errors: 0, errorDevices: new Set() },
        sensors: { success: 0, errors: 0, errorDevices: new Set() },
        battery: { success: 0, errors: 0, errorDevices: new Set() },
        discovery: { success: 0, errors: 0, lastError: null }
    };
    this.lastStatsReport = Date.now();
    
    // Device list cache
    this.deviceListCache = null;
    this.deviceListCacheTime = 0;
    this.CACHE_DURATION = 10000; // 10 seconds cache
    
    // For Homebridge v1.0+ compatibility
    if (api) {
        this.api = api;
        
        // Initialize the fritz API with this platform instance
        fritz.init(this);
        
        // Listen for the event that all cached accessories have been restored
        this.api.on('didFinishLaunching', () => {
            this.log("Homebridge finished launching");
            this.discoverDevices();
        });
        
        // Register for shutdown cleanup
        if (this.api.on) {
            this.api.on('shutdown', () => {
                this.cleanup();
            });
        }
    }
}

FritzPlatform.prototype = {
    // Called when homebridge restores cached accessories from disk at startup
    configureAccessory: function(accessory) {
        this.log("Configuring cached accessory: " + accessory.displayName);
        
        // Mark as not reachable until we confirm it exists
        accessory.reachable = false;
        
        // Add to our accessory array
        this.accessories.push(accessory);
        
        // Re-setup event handlers
        this.setupAccessoryHandlers(accessory);
    },

    // Initial device discovery after homebridge has finished launching
    discoverDevices: function() {
        const self = this;
        
        fritz.getSessionID(this.config.username, this.config.password, this.options).then(function(sid) {
            self.log("FRITZ!Box platform login successful");
            self.sid = sid;
            
            self.log("Discovering accessories");
            
            // Update device list and accessories
            return self.updateAccessories().then(() => {
                // Setup polling system only after successful login and device discovery
                if (!self.pollingSetup) {
                    self.setupPollingSystem();
                    self.pollingSetup = true;
                }
            });
        })
        .catch(function(error) {
            self.log.error("FRITZ!Box login failed:", error ? error.message || error.toString() : 'Unknown error');
            // Set a flag to retry login after a delay
            self.loginRetryTimer = setTimeout(() => {
                self.log("Retrying FRITZ!Box login...");
                self.discoverDevices();
            }, 30000); // Retry after 30 seconds
        });
    },

    // Update accessories - called initially and every 5 minutes (discovery polling)
    updateAccessories: function() {
        const self = this;
        
        // Check if we have a valid session
        if (!this.sid) {
            this.log.error("No valid session ID for updateAccessories - skipping update");
            return Promise.reject(new Error("No valid session ID"));
        }
        
        // First update the device list
        return this.updateDeviceList().then(function(devices) {
            // Process devices based on functionbitmask
            self.processDevicesByFunctionBitmask(devices);
            // Handle WiFi accessory
            if (self.deviceConfig("wifi.display", true)) {
                self.addOrUpdateWifiAccessory();
            }
            
            // Remove accessories that no longer exist
            self.removeStaleAccessories();
        })
        .catch(function(error) {
            self.log.error("Error updating accessories:", error);
            // Mark all accessories as unreachable on error
            self.accessories.forEach(function(accessory) {
                accessory.reachable = false;
            });
            // Re-throw the error to maintain the promise chain
            throw error;
        });
    },

    // Add or update WiFi accessory
    addOrUpdateWifiAccessory: function() {
        const uuid = Homebridge.hap.uuid.generate('wifi');
        let accessory = this.accessories.find(acc => acc.UUID === uuid);
        
        if (!accessory) {
            // Create new accessory
            accessory = new PlatformAccessory('Guest WLAN', uuid, Homebridge.hap.Categories.SWITCH);
            accessory.context.type = 'wifi';
            
            this.setupWifiAccessory(accessory);
            this.api.registerPlatformAccessories("homebridge-fritz-new", "FRITZ!Box", [accessory]);
            this.accessories.push(accessory);
            this.log("Added WiFi accessory");
        } else {
            // Update existing
            accessory.reachable = true;
            this.api.updatePlatformAccessories([accessory]);
        }
    },

    // Add or update outlet accessory
    addOrUpdateOutletAccessory: function(ain) {
        const device = this.getDevice(ain);
        const uuid = Homebridge.hap.uuid.generate('outlet-' + ain);
        let accessory = this.accessories.find(acc => acc.UUID === uuid);
        
        if (!accessory) {
            // Create new accessory
            const name = device.name || ain;
            accessory = new PlatformAccessory(name, uuid, Homebridge.hap.Categories.OUTLET);
            accessory.context.ain = ain;
            accessory.context.type = 'outlet';
            
            // Store device info in context
            if (device.manufacturer) accessory.context.manufacturer = device.manufacturer;
            if (device.productname) accessory.context.productname = device.productname;
            if (device.fwversion) accessory.context.fwversion = device.fwversion;
            
            this.setupOutletAccessory(accessory);
            this.api.registerPlatformAccessories("homebridge-fritz-new", "FRITZ!Box", [accessory]);
            this.accessories.push(accessory);
            this.log("Added outlet accessory: " + name);
        } else {
            // Update existing
            accessory.reachable = true;
            accessory.displayName = device.name || ain;
            
            // Update device info in context
            if (device.manufacturer) accessory.context.manufacturer = device.manufacturer;
            if (device.productname) accessory.context.productname = device.productname;
            if (device.fwversion) accessory.context.fwversion = device.fwversion;
            
            this.api.updatePlatformAccessories([accessory]);
        }
    },

    // Add or update thermostat accessory
    addOrUpdateThermostatAccessory: function(ain) {
        const device = this.getDevice(ain);
        const uuid = Homebridge.hap.uuid.generate('thermostat-' + ain);
        let accessory = this.accessories.find(acc => acc.UUID === uuid);
        
        if (!accessory) {
            // Create new accessory
            const name = device.name || ain;
            accessory = new PlatformAccessory(name, uuid, Homebridge.hap.Categories.THERMOSTAT);
            accessory.context.ain = ain;
            accessory.context.type = 'thermostat';
            accessory.context.functionbitmask = device.functionbitmask || 0;
            accessory.context.features = device.features || {};
            
            // Store device info in context
            if (device.manufacturer) accessory.context.manufacturer = device.manufacturer;
            if (device.productname) accessory.context.productname = device.productname;
            if (device.fwversion) accessory.context.fwversion = device.fwversion;
            
            this.setupThermostatAccessory(accessory);
            this.api.registerPlatformAccessories("homebridge-fritz-new", "FRITZ!Box", [accessory]);
            this.accessories.push(accessory);
            this.log("Added thermostat accessory: " + name);
        } else {
            // Update existing
            accessory.reachable = true;
            accessory.displayName = device.name || ain;
            accessory.context.functionbitmask = device.functionbitmask || 0;
            accessory.context.features = device.features || {};
            
            // Update device info in context
            if (device.manufacturer) accessory.context.manufacturer = device.manufacturer;
            if (device.productname) accessory.context.productname = device.productname;
            if (device.fwversion) accessory.context.fwversion = device.fwversion;
            
            this.api.updatePlatformAccessories([accessory]);
        }
    },

    // Add or update temperature sensor accessory
    addOrUpdateTemperatureSensorAccessory: function(ain) {
        const device = this.getDevice(ain);
        const uuid = Homebridge.hap.uuid.generate('temperaturesensor-' + ain);
        let accessory = this.accessories.find(acc => acc.UUID === uuid);
        
        if (!accessory) {
            // Create new accessory
            const name = device.name || ain;
            accessory = new PlatformAccessory(name, uuid, Homebridge.hap.Categories.SENSOR);
            accessory.context.ain = ain;
            accessory.context.type = 'temperaturesensor';
            
            // Store device info in context
            if (device.manufacturer) accessory.context.manufacturer = device.manufacturer;
            if (device.productname) accessory.context.productname = device.productname;
            if (device.fwversion) accessory.context.fwversion = device.fwversion;
            
            this.setupTemperatureSensorAccessory(accessory);
            this.api.registerPlatformAccessories("homebridge-fritz-new", "FRITZ!Box", [accessory]);
            this.accessories.push(accessory);
            this.log("Added temperature sensor accessory: " + name);
        } else {
            // Update existing
            accessory.reachable = true;
            accessory.displayName = device.name || ain;
            
            // Update device info in context
            if (device.manufacturer) accessory.context.manufacturer = device.manufacturer;
            if (device.productname) accessory.context.productname = device.productname;
            if (device.fwversion) accessory.context.fwversion = device.fwversion;
            
            this.api.updatePlatformAccessories([accessory]);
        }
    },

    // Add or update alarm sensor accessory
    addOrUpdateAlarmSensorAccessory: function(ain) {
        const device = this.getDevice(ain);
        const uuid = Homebridge.hap.uuid.generate('alarmsensor-' + ain);
        let accessory = this.accessories.find(acc => acc.UUID === uuid);
        
        if (!accessory) {
            // Create new accessory
            const name = device.name || ain;
            accessory = new PlatformAccessory(name, uuid, Homebridge.hap.Categories.SENSOR);
            accessory.context.ain = ain;
            accessory.context.type = 'alarmsensor';
            
            // Store device info in context
            if (device.manufacturer) accessory.context.manufacturer = device.manufacturer;
            if (device.productname) accessory.context.productname = device.productname;
            if (device.fwversion) accessory.context.fwversion = device.fwversion;
            
            this.setupAlarmSensorAccessory(accessory);
            this.api.registerPlatformAccessories("homebridge-fritz-new", "FRITZ!Box", [accessory]);
            this.accessories.push(accessory);
            this.log("Added alarm sensor accessory: " + name);
        } else {
            // Update existing
            accessory.reachable = true;
            accessory.displayName = device.name || ain;
            
            // Update device info in context
            if (device.manufacturer) accessory.context.manufacturer = device.manufacturer;
            if (device.productname) accessory.context.productname = device.productname;
            if (device.fwversion) accessory.context.fwversion = device.fwversion;
            
            this.api.updatePlatformAccessories([accessory]);
        }
    },

    // Add or update button accessory
    addOrUpdateButtonAccessory: function(ain, index, buttonName) {
        const device = this.getDevice(ain);
        const uuid = Homebridge.hap.uuid.generate('button-' + ain + '-' + index);
        let accessory = this.accessories.find(acc => acc.UUID === uuid);
        
        if (!accessory) {
            // Create new accessory
            const name = buttonName || `${device.name || ain} Button ${index + 1}`;
            accessory = new PlatformAccessory(name, uuid, Homebridge.hap.Categories.SWITCH);
            accessory.context.ain = ain;
            accessory.context.type = 'button';
            accessory.context.index = index;
            
            // Store device info in context
            if (device.manufacturer) accessory.context.manufacturer = device.manufacturer;
            if (device.productname) accessory.context.productname = device.productname;
            if (device.fwversion) accessory.context.fwversion = device.fwversion;
            
            this.setupButtonAccessory(accessory);
            this.api.registerPlatformAccessories("homebridge-fritz-new", "FRITZ!Box", [accessory]);
            this.accessories.push(accessory);
            this.log("Added button accessory: " + name);
        } else {
            // Update existing
            accessory.reachable = true;
            accessory.displayName = buttonName || `${device.name || ain} Button ${index + 1}`;
            
            // Update device info in context
            if (device.manufacturer) accessory.context.manufacturer = device.manufacturer;
            if (device.productname) accessory.context.productname = device.productname;
            if (device.fwversion) accessory.context.fwversion = device.fwversion;
            
            this.api.updatePlatformAccessories([accessory]);
        }
    },

    // Add or update light accessory
    addOrUpdateLightAccessory: function(ain) {
        const device = this.getDevice(ain);
        const uuid = Homebridge.hap.uuid.generate('lightbulb-' + ain);
        let accessory = this.accessories.find(acc => acc.UUID === uuid);

        if (!accessory) {
            const name = device.name || ain;
            accessory = new PlatformAccessory(name, uuid, Homebridge.hap.Categories.LIGHTBULB);
            accessory.context.ain = ain;
            accessory.context.type = 'lightbulb';
            accessory.context.functionbitmask = device.functionbitmask || 0;
            accessory.context.features = device.features || {};

            if (device.manufacturer) accessory.context.manufacturer = device.manufacturer;
            if (device.productname) accessory.context.productname = device.productname;
            if (device.fwversion) accessory.context.fwversion = device.fwversion;

            this.setupLightAccessory(accessory);
            this.api.registerPlatformAccessories("homebridge-fritz-new", "FRITZ!Box", [accessory]);
            this.accessories.push(accessory);
            this.log("Added light accessory: " + name);
        } else {
            accessory.reachable = true;
            accessory.displayName = device.name || ain;
            accessory.context.functionbitmask = device.functionbitmask || 0;
            accessory.context.features = device.features || {};

            if (device.manufacturer) accessory.context.manufacturer = device.manufacturer;
            if (device.productname) accessory.context.productname = device.productname;
            if (device.fwversion) accessory.context.fwversion = device.fwversion;

            this.updateAccessoryServices(accessory);

            const instance = this.accessoryInstances.get(accessory.UUID);
            if (instance && typeof instance.update === 'function') {
                instance.update(device);
            }

            this.api.updatePlatformAccessories([accessory]);
        }
    },

    // Remove accessories that no longer exist
    removeStaleAccessories: function() {
        const self = this;
        const staleAccessories = [];
        
        this.accessories.forEach(function(accessory) {
            let shouldRemove = false;
            
            if (accessory.context.type === 'wifi') {
                // Check if WiFi should still be displayed
                shouldRemove = !self.deviceConfig("wifi.display", true);
            } else if (accessory.context.ain) {
                // Check if device still exists
                const device = self.getDevice(accessory.context.ain);
                if (!device || !device.identifier) {
                    shouldRemove = true;
                } else {
                    // Check if device should still be displayed
                    shouldRemove = !self.deviceConfig(`${accessory.context.ain}.display`, true);
                }
            }
            
            if (shouldRemove) {
                staleAccessories.push(accessory);
            }
        });
        
        if (staleAccessories.length > 0) {
            this.log("Removing " + staleAccessories.length + " stale accessories");
            this.api.unregisterPlatformAccessories("homebridge-fritz-new", "FRITZ!Box", staleAccessories);
            
            staleAccessories.forEach(function(accessory) {
                const index = self.accessories.indexOf(accessory);
                if (index > -1) {
                    self.accessories.splice(index, 1);
                }
                
                // Clean up accessory instance (timers, etc.)
                const instance = self.accessoryInstances.get(accessory.UUID);
                if (instance && typeof instance.cleanup === 'function') {
                    instance.cleanup();
                }
                self.accessoryInstances.delete(accessory.UUID);
            });
        }
    },

    // Setup handlers for restored accessories
    setupAccessoryHandlers: function(accessory) {
        // Based on accessory type, setup appropriate handlers
        switch (accessory.context.type) {
            case 'wifi':
                this.setupWifiAccessory(accessory);
                break;
            case 'outlet':
                this.setupOutletAccessory(accessory);
                break;
            case 'thermostat':
                this.setupThermostatAccessory(accessory);
                break;
            case 'temperaturesensor':
                this.setupTemperatureSensorAccessory(accessory);
                break;
            case 'alarmsensor':
                this.setupAlarmSensorAccessory(accessory);
                break;
            case 'button':
                this.setupButtonAccessory(accessory);
                break;
            case 'lightbulb':
                this.setupLightAccessory(accessory);
                break;
        }
    },

    // Setup WiFi accessory
    setupWifiAccessory: function(accessory) {
        const FritzWifiAccessory = require('./accessories/wifi')(Homebridge);
        const wifiAccessory = new FritzWifiAccessory(this, accessory);
        // Store in map for cleanup, not in context to avoid circular references
        this.accessoryInstances.set(accessory.UUID, wifiAccessory);
    },

    // Setup outlet accessory
    setupOutletAccessory: function(accessory) {
        const FritzOutletAccessory = require('./accessories/outlet')(Homebridge);
        const outletAccessory = new FritzOutletAccessory(this, accessory.context.ain, 'outlet', accessory);
        // Store in map for cleanup, not in context to avoid circular references
        this.accessoryInstances.set(accessory.UUID, outletAccessory);
    },

    // Setup thermostat accessory
    setupThermostatAccessory: function(accessory) {
        const FritzThermostatAccessory = require('./accessories/thermostat')(Homebridge);
        const thermostatAccessory = new FritzThermostatAccessory(this, accessory.context.ain, 'thermostat', accessory);
        // Store in map for cleanup, not in context to avoid circular references
        this.accessoryInstances.set(accessory.UUID, thermostatAccessory);
    },

    // Setup temperature sensor accessory
    setupTemperatureSensorAccessory: function(accessory) {
        const FritzTemperatureSensorAccessory = require('./accessories/temperaturesensor')(Homebridge);
        const sensorAccessory = new FritzTemperatureSensorAccessory(this, accessory.context.ain, 'temperature sensor', accessory);
        // Store in map for cleanup, not in context to avoid circular references
        this.accessoryInstances.set(accessory.UUID, sensorAccessory);
    },

    // Setup alarm sensor accessory
    setupAlarmSensorAccessory: function(accessory) {
        const FritzAlarmSensorAccessory = require('./accessories/alarmsensor')(Homebridge);
        const alarmAccessory = new FritzAlarmSensorAccessory(this, accessory.context.ain, 'alarm sensor', accessory);
        // Store in map for cleanup, not in context to avoid circular references
        this.accessoryInstances.set(accessory.UUID, alarmAccessory);
    },

    // Setup button accessory
    setupButtonAccessory: function(accessory) {
        const FritzButtonAccessory = require('./accessories/button')(Homebridge);
        const buttonAccessory = new FritzButtonAccessory(this, accessory.context.ain, 'button', accessory);
        // Store in map for cleanup, not in context to avoid circular references
        this.accessoryInstances.set(accessory.UUID, buttonAccessory);
    },

    // Setup light accessory
    setupLightAccessory: function(accessory) {
        const FritzLightbulbAccessory = require('./accessories/lightbulb')(Homebridge);
        const lightAccessory = new FritzLightbulbAccessory(this, accessory.context.ain, 'lightbulb', accessory);
        this.accessoryInstances.set(accessory.UUID, lightAccessory);
    },

    deviceConfig: function(key, defaultValue) {
        return get(this.config.devices, key, defaultValue)
    },

    getArrayString: function(array) {
        return array.toString() || "none";
    },

    updateDeviceList: function() {
        if (this.log && this.log.debug) {
            this.log.debug("updateDeviceList: Starting device list update");
        }
        return this.fritz("getDeviceList")
            .then(function(devices) {
                if (this.log && this.log.debug) {
                    this.log.debug("updateDeviceList: Received devices:", devices);
                }
                this.log("Found " + (devices ? devices.length : 0) + " smart home devices");
                // cache list of devices in options for reuse by non-API functions
                this.deviceList = devices || [];
                return devices || [];
            }.bind(this))
            .catch(function(error) {
                this.log.error("getDeviceList failed:", error ? error.message || error.toString() : 'Unknown error');
                if (error && error.originalError && this.log && this.log.debug) {
                    this.log.debug("Original error:", error.originalError);
                }
                // Don't re-throw, return empty device list instead
                this.deviceList = [];
                return [];
            }.bind(this));
    },

    getDevice: function(ain) {
        const device = this.deviceList.find(function(device) {
            return device.identifier.replace(/\s/g, '') == ain;
        });
        return device || {}; // safeguard
    },

    getName: function(ain) {
        const dev = this.getDevice(ain);
        return dev.name || ain;
    },

    fritz: function(func) {
        const args = Array.prototype.slice.call(arguments, 1);
        const self = this;
        
        // Extract priority if provided as last argument
        let priority = 0;
        const lastArg = args[args.length - 1];
        if (lastArg && typeof lastArg === 'object' && 'priority' in lastArg) {
            priority = lastArg.priority;
            // Remove priority from the args
            delete args[args.length - 1].priority;
            // If the options object is now empty, remove it
            if (Object.keys(args[args.length - 1]).length === 0 && args.length > 1) {
                args.pop();
            }
        }
        
        // Use request queue to limit concurrent requests
        return this.requestQueue.add(async () => {
            // Special handling for getDeviceList with caching
            if (func === 'getDeviceListFiltered' && args.length === 0) {
                const now = Date.now();
                if (this.deviceListCache && (now - this.deviceListCacheTime < this.CACHE_DURATION)) {
                    this.log.debug('Returning cached device list');
                    return this.deviceListCache;
                }
            }
            
            try {
                // Use the new makeRequest API with automatic session renewal
                const requestArg = args.length > 1 ? args[1] : {};
                const result = await fritz.makeRequest(func, args[0], requestArg);
                
                // Cache device list results
                if (func === 'getDeviceListFiltered' && args.length === 0) {
                    this.deviceListCache = result;
                    this.deviceListCacheTime = Date.now();
                    this.log.debug('Cached device list for 10 seconds');
                }
                
                return result;
            } catch (error) {
                // Don't treat timeouts as session errors
                if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
                    this.log.warn(`Request '${func}' timed out. Fritz!Box might be busy.`);
                    // Don't re-throw as different error, let caller handle it
                }
                
                // Don't treat 'inval' as session error  
                if (error.message && error.message.includes('inval')) {
                    this.log.warn(`Request '${func}' failed with 'inval'. Fritz!Box might be busy.`);
                    // Don't re-throw as different error, let caller handle it
                }
                
                // Re-throw the original error
                throw error;
            }
        }, { priority });

    },

    fritzApi: function() {
        return fritz;
    },
    
    // Report polling statistics every 60 seconds
    reportPollingStats: function() {
        const stats = this.pollingStats;
        const total = {
            success: stats.switches.success + stats.sensors.success + stats.battery.success + stats.discovery.success,
            errors: stats.switches.errors + stats.sensors.errors + stats.battery.errors + stats.discovery.errors
        };
        
        if (total.success + total.errors === 0) {
            // No polling has happened yet
            this.log.debug('No polling activity to report yet');
            return;
        }
        
        // Build summary message
        let summary = `Polling summary (last 60s): ${total.success} successful, ${total.errors} errors`;
        
        // Add error details if any
        if (total.errors > 0) {
            const errorDetails = [];
            
            if (stats.switches.errorDevices.size > 0) {
                errorDetails.push(`Switches: ${Array.from(stats.switches.errorDevices).join(', ')}`);
            }
            if (stats.sensors.errorDevices.size > 0) {
                errorDetails.push(`Sensors: ${Array.from(stats.sensors.errorDevices).join(', ')}`);
            }
            if (stats.battery.errorDevices.size > 0) {
                errorDetails.push(`Battery: ${Array.from(stats.battery.errorDevices).join(', ')}`);
            }
            if (stats.discovery.errors > 0 && stats.discovery.lastError) {
                errorDetails.push(`Discovery: ${stats.discovery.lastError}`);
            }
            
            if (errorDetails.length > 0) {
                summary += ` | Failed devices: ${errorDetails.join(' | ')}`;
            }
        }
        
        this.log(summary);
        
        // Reset statistics
        stats.switches = { success: 0, errors: 0, errorDevices: new Set() };
        stats.sensors = { success: 0, errors: 0, errorDevices: new Set() };
        stats.battery = { success: 0, errors: 0, errorDevices: new Set() };
        stats.discovery = { success: 0, errors: 0, lastError: null };
    },
    
    // Cleanup method for platform shutdown
    cleanup: function() {
        this.log("Cleaning up platform...");
        
        // Clear update interval
        // Clear all polling intervals
        if (this.discoveryTimer) {
            clearInterval(this.discoveryTimer);
            this.discoveryTimer = null;
        }
        if (this.stateTimer) {
            clearInterval(this.stateTimer);
            this.stateTimer = null;
        }
        if (this.sensorTimer) {
            clearInterval(this.sensorTimer);
            this.sensorTimer = null;
        }
        if (this.batteryTimer) {
            clearInterval(this.batteryTimer);
            this.batteryTimer = null;
        }
        if (this.statsTimer) {
            clearInterval(this.statsTimer);
            this.statsTimer = null;
        }
        // Legacy interval
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
        // Clear login retry timer
        if (this.loginRetryTimer) {
            clearTimeout(this.loginRetryTimer);
            this.loginRetryTimer = null;
        }
        
        // Clean up all accessory instances
        this.accessoryInstances.forEach((instance, uuid) => {
            if (instance && typeof instance.cleanup === 'function') {
                try {
                    instance.cleanup();
                } catch (error) {
                    this.log.error(`Error cleaning up accessory ${uuid}:`, error.message);
                }
            }
        });
        
        // Clear the instances map
        this.accessoryInstances.clear();
    },
    
    // Setup two-stage polling system
    setupPollingSystem: function() {
        const self = this;
        
        // Ensure we have a valid session
        if (!this.sid) {
            this.log.error("Cannot setup polling system - no session available");
            return;
        }
        
        this.log("Setting up polling system with active session");
        this.log(`Polling intervals: discovery=${this.discoveryInterval}ms, state=${this.statePollingInterval}ms, sensor=${this.sensorPollingInterval}ms, battery=${this.batteryPollingInterval}ms`);
        this.log("Polling status will be reported every 60 seconds");
        
        // Stats reporting timer - every 60 seconds
        this.statsTimer = setInterval(() => {
            self.reportPollingStats();
        }, 60000);
        
        // Report initial status after 60 seconds
        setTimeout(() => {
            self.log.debug('Running initial polling report after 60 seconds');
            self.reportPollingStats();
        }, 60000);
        
        // Initial battery query for all thermostats after 5 seconds
        setTimeout(() => {
            self.log.info('Running initial battery query for all thermostats');
            self.accessories.forEach(accessory => {
                if (accessory.context.type === 'thermostat' && accessory.reachable) {
                    const instance = self.accessoryInstances.get(accessory.UUID);
                    if (instance && instance.queryBatteryLevel) {
                        instance.queryBatteryLevel();
                    }
                }
            });
        }, 5000);
        
        // Discovery polling - every 5 minutes
        this.discoveryTimer = setInterval(() => {
            // Only poll if we have a valid session
            if (!self.sid) {
                self.log.debug("Skipping discovery polling - no session available");
                return;
            }
            
            self.log.debug("Running discovery polling...");
            
            self.updateAccessories().catch(error => {
                self.log.error("Error in discovery polling:", error.message);
            });
        }, this.discoveryInterval);
        
        // State polling - every 3 seconds for switches
        this.stateTimer = setInterval(() => {
            // Only poll if we have a valid session
            if (!self.sid) {
                self.log.debug("Skipping state polling - no session available");
                return;
            }
            
            self.log.debug("Running state polling for switches...");
            self.pollSwitchStates().catch(error => {
                self.log.debug("Error in state polling:", error.message);
            });
        }, this.statePollingInterval);
        
        // Sensor polling - every 10 seconds
        this.sensorTimer = setInterval(() => {
            // Only poll if we have a valid session
            if (!self.sid) {
                self.log.debug("Skipping sensor polling - no session available");
                return;
            }
            
            self.log.debug("Running sensor data polling...");
            self.pollSensorData().catch(error => {
                self.log.debug("Error in sensor polling:", error.message);
            });
        }, this.sensorPollingInterval);
        
        // Battery polling - every 15 minutes
        this.batteryTimer = setInterval(() => {
            // Only poll if we have a valid session
            if (!self.sid) {
                self.log.debug("Skipping battery polling - no session available");
                return;
            }
            
            self.log.debug("Running battery status polling...");
            self.pollBatteryStatus().catch(error => {
                self.log.debug("Error in battery polling:", error.message);
            });
        }, this.batteryPollingInterval);
    },
    
    // Poll switch states for fast response
    pollSwitchStates: function() {
        const self = this;
        const promises = [];
        
        // Check if we have a valid session
        if (!this.sid) {
            this.log.debug("pollSwitchStates: No session available");
            return Promise.resolve();
        }
        
        // Count outlets/switches
        const switches = this.accessories.filter(acc => 
            acc.reachable && acc.context.ain && 
            (acc.context.type === 'outlet' || acc.context.type === 'switch' || acc.context.type === 'lightbulb')
        );
        
        if (switches.length > 0) {
            this.log.debug(`Polling state for ${switches.length} switches/lights`);
        }
        
        this.accessories.forEach(function(accessory) {
            if (accessory.reachable && accessory.context.ain && 
                (accessory.context.type === 'outlet' || accessory.context.type === 'switch')) {
                
                const promise = self.fritz('getSwitchState', accessory.context.ain)
                    .then(function(state) {
                        const instance = self.accessoryInstances.get(accessory.UUID);
                        const oldState = instance && instance.services && instance.services.Outlet ? 
                            instance.services.Outlet.fritzState : undefined;
                        
                        // Log only if state changed
                        if (oldState !== undefined && oldState !== state) {
                            self.log(`${accessory.displayName} state changed: ${oldState ? 'ON' : 'OFF'} → ${state ? 'ON' : 'OFF'}`);
                        }
                        if (instance && instance.services && instance.services.Outlet) {
                            const currentState = instance.services.Outlet.fritzState;
                            if (currentState !== state) {
                                self.log.debug(`Switch state changed for ${accessory.displayName}: ${currentState} -> ${state}`);
                                instance.services.Outlet.fritzState = state;
                                instance.services.Outlet
                                    .getCharacteristic(self.api.hap.Characteristic.On)
                                    .updateValue(state);
                            }
                        }
                        // Success statistics
                        self.pollingStats.switches.success++;
                    })
                    .catch(function(error) {
                        // Log individual errors but don't fail the whole polling
                        self.log.debug(`Failed to poll switch state for ${accessory.context.ain}:`, error.message);
                        self.pollingStats.switches.errors++;
                        self.pollingStats.switches.errorDevices.add(accessory.displayName || accessory.context.ain);
                    });
                    
                promises.push(promise);
            } else if (accessory.reachable && accessory.context.ain && accessory.context.type === 'lightbulb') {
                const instance = self.accessoryInstances.get(accessory.UUID);
                if (instance && typeof instance.queryState === 'function') {
                    const promise = instance.queryState()
                        .then(function() {
                            self.pollingStats.switches.success++;
                        })
                        .catch(function(error) {
                            self.log.debug(`Failed to poll light state for ${accessory.context.ain}:`, error.message);
                            self.pollingStats.switches.errors++;
                            self.pollingStats.switches.errorDevices.add(accessory.displayName || accessory.context.ain);
                        });

                    promises.push(promise);
                }
            }
        });
        
        return Promise.all(promises).catch(function(error) {
            self.log.debug("Error in pollSwitchStates Promise.all:", error.message);
            return Promise.resolve();
        });
    },
    
    // Poll sensor data (temperature, power)
    pollSensorData: function() {
        const self = this;
        const promises = [];
        
        // Check if we have a valid session
        if (!this.sid) {
            this.log.debug("pollSensorData: No session available");
            return Promise.resolve();
        }
        
        // Count sensors to poll
        const sensors = this.accessories.filter(acc => 
            acc.reachable && acc.context.ain && 
            (acc.context.type === 'outlet' || acc.context.type === 'thermostat' || acc.context.type === 'temperaturesensor')
        );
        
        if (sensors.length > 0) {
            this.log.debug(`Polling sensor data for ${sensors.length} devices`);
        }
        
        this.accessories.forEach(function(accessory) {
            if (!accessory.reachable || !accessory.context.ain) return;
            
            const instance = self.accessoryInstances.get(accessory.UUID);
            if (!instance) return;
            
            // Power data for outlets
            if (accessory.context.type === 'outlet' && instance.queryPowerUsage) {
                promises.push(
                    Promise.resolve(instance.queryPowerUsage())
                        .then(() => {
                            self.pollingStats.sensors.success++;
                        })
                        .catch(function(error) {
                            // Log but don't fail the whole polling
                            self.log.debug(`Failed to poll power usage for ${accessory.context.ain}:`, error.message);
                            self.pollingStats.sensors.errors++;
                            self.pollingStats.sensors.errorDevices.add(accessory.displayName || accessory.context.ain);
                            return null;
                        })
                );
            }
            
            // Temperature data
            if ((accessory.context.type === 'temperaturesensor' || 
                 accessory.context.type === 'thermostat' ||
                 (accessory.context.type === 'outlet' && instance.services.TemperatureSensor)) && 
                instance.queryCurrentTemperature) {
                
                promises.push(
                    Promise.resolve(instance.queryCurrentTemperature())
                        .then(() => {
                            self.pollingStats.sensors.success++;
                        })
                        .catch(function(error) {
                            // Log but don't fail the whole polling
                            self.log.debug(`Failed to poll temperature for ${accessory.context.ain}:`, error.message);
                            self.pollingStats.sensors.errors++;
                            self.pollingStats.sensors.errorDevices.add(accessory.displayName || accessory.context.ain);
                            return null;
                        })
                );
            }
        });
        
        return Promise.all(promises).catch(function(error) {
            self.log.debug("Error in pollSensorData Promise.all:", error.message);
            return Promise.resolve();
        });
    },
    
    // Poll battery status for battery-powered devices
    pollBatteryStatus: function() {
        const self = this;
        const promises = [];
        
        // Check if we have a valid session
        if (!this.sid) {
            return Promise.resolve();
        }
        
        this.accessories.forEach(function(accessory) {
            if (!accessory.reachable || !accessory.context.ain) return;
            
            // Only poll battery for devices that actually have batteries
            if (accessory.context.features && accessory.context.features.hasBattery) {
                
                const promise = self.fritz('getBatteryCharge', accessory.context.ain)
                    .then(function(battery) {
                        const instance = self.accessoryInstances.get(accessory.UUID);
                        if (instance && instance.services) {
                            // Update battery status if service exists
                            const service = instance.services.Thermostat || 
                                          instance.services.ContactSensor ||
                                          instance.services.Switch;
                            
                            if (service && service.getCharacteristic) {
                                const batteryChar = service.getCharacteristic(Characteristic.StatusLowBattery);
                                if (batteryChar) {
                                    batteryChar.updateValue(battery < 20 ? 1 : 0);
                                }
                            }
                        }
                        self.pollingStats.battery.success++;
                    })
                    .catch(function(error) {
                        // Log but don't fail the whole polling
                        self.log.debug(`Failed to poll battery for ${accessory.context.ain}:`, error.message);
                        self.pollingStats.battery.errors++;
                        self.pollingStats.battery.errorDevices.add(accessory.displayName || accessory.context.ain);
                    });
                    
                promises.push(promise);
            }
        });
        
        return Promise.all(promises).catch(function(error) {
            self.log.debug("Error in pollBatteryStatus Promise.all:", error.message);
            return Promise.resolve();
        });
    },
    
    // Process devices based on their functionbitmask
    processDevicesByFunctionBitmask: function(devices) {
        const self = this;
        
        devices.forEach(function(device) {
            if (!device.identifier) return;
            
            const ain = device.identifier.replace(/\s/g, '');
            const functionbitmask = parseInt(device.functionbitmask) || 0;
            
            // Skip if device should not be displayed
            if (!self.deviceConfig(`${ain}.display`, true)) {
                return;
            }
            
            // Store functionbitmask in device for later use
            device.functionbitmask = functionbitmask;
            
            // Log device features for debugging
            if (device.features) {
                self.log.debug(`Device ${device.name} features:`, JSON.stringify(device.features));
            }
            
            // XML-First: Determine device type based on actual XML elements
            // Priority order: More specific types first
            
            // Thermostats (has HKR element)
            if (device.hkr || (device.features && device.features.hasThermostat)) {
                self.addOrUpdateThermostatAccessory(ain);
            }
            // Outlets/Switches (has switch element)
            else if (device.switch || (device.features && device.features.hasSwitch)) {
                self.addOrUpdateOutletAccessory(ain);
            }
            // Color/Dimmable lights
            else if (device.colorcontrol || device.levelcontrol || (device.features && device.features.hasDimmer)) {
                self.addOrUpdateLightAccessory(ain);
            }
            // Blinds/Shutters (future support)
            else if (device.blind) {
                self.log.info(`Blind device detected: ${device.name} - Future HomeKit support planned`);
            }
            // Standalone temperature sensors
            else if (device.temperature || (device.features && device.features.hasTemperature)) {
                // Only if not part of outlet or thermostat
                if (!device.switch && !device.hkr) {
                    if (self.deviceConfig(`${ain}.TemperatureSensor`, true)) {
                        self.addOrUpdateTemperatureSensorAccessory(ain);
                    }
                }
            }
            
            // Additional sensors (can coexist with main type)
            
            // Alarm/Contact sensors
            if (device.alert || (device.features && device.features.hasAlarm)) {
                if (self.deviceConfig(`${ain}.ContactSensor`, true)) {
                    self.addOrUpdateAlarmSensorAccessory(ain);
                }
            }
            
            // Buttons
            if (device.button || (device.features && device.features.hasButton)) {
                const buttons = Array.isArray(device.button) ? device.button : [device.button];
                buttons.forEach(function(button, index) {
                    self.addOrUpdateButtonAccessory(ain, index, button.name || `Button ${index + 1}`);
                });
            }
            
            // Log unknown elements for future development
            if (device.features && device.features.unknownElements && device.features.unknownElements.length > 0) {
                self.log.debug(`Device ${device.name} has unknown elements: ${device.features.unknownElements.join(', ')}`);
            }
        });
    },
    
    // Helper method for tests - create accessory from device
    createAccessoryFromDevice: function(device) {
        const ain = device.identifier.replace(/\s/g, '');
        const functionbitmask = device.functionbitmask || 0;
        
        // Determine primary accessory type
        let accessoryType = null;
        let category = null;
        
        if (functionbitmask & 512) { // Outlet
            accessoryType = 'outlet';
            category = Homebridge.hap.Categories.OUTLET;
        } else if (functionbitmask & 256) { // Thermostat
            accessoryType = 'thermostat';
            category = Homebridge.hap.Categories.THERMOSTAT;
        } else if (functionbitmask & 32) { // Temperature sensor only
            accessoryType = 'temperaturesensor';
            category = Homebridge.hap.Categories.SENSOR;
        } else if (device.levelcontrol || device.colorcontrol || (device.features && device.features.hasDimmer)) {
            accessoryType = 'lightbulb';
            category = Homebridge.hap.Categories.LIGHTBULB;
        }
        
        if (!accessoryType) return null;
        
        const uuid = Homebridge.hap.uuid.generate(`${accessoryType}-${ain}`);
        const accessory = new PlatformAccessory(
            device.name || ain,
            uuid,
            category
        );
        
        accessory.context = {
            ain: ain,
            type: accessoryType,
            functionbitmask: functionbitmask,
            features: device.features || {}
        };
        
        return accessory;
    },
    
    // Helper method for tests - setup services for accessory
    setupServicesForAccessory: function(accessory) {
        const functionbitmask = accessory.context.functionbitmask || 0;
        const services = [];
        
        // Always add AccessoryInformation
        const infoService = new Homebridge.hap.Service.AccessoryInformation();
        services.push(infoService);
        
        // Add primary service based on type
        if (accessory.context.type === 'outlet') {
            const outletService = new Homebridge.hap.Service.Outlet();
            services.push(outletService);
            
            // Add power characteristics if power meter present
            if (functionbitmask & 65536) {
                if (FritzPlatform.PowerUsage) {
                    outletService.addCharacteristic(new FritzPlatform.PowerUsage());
                }
                if (FritzPlatform.EnergyConsumption) {
                    outletService.addCharacteristic(new FritzPlatform.EnergyConsumption());
                }
                if (FritzPlatform.Voltage) {
                    outletService.addCharacteristic(new FritzPlatform.Voltage());
                }
            }
        } else if (accessory.context.type === 'thermostat') {
            const thermostatService = new Homebridge.hap.Service.Thermostat();
            services.push(thermostatService);
        } else if (accessory.context.type === 'temperaturesensor') {
            const tempService = new Homebridge.hap.Service.TemperatureSensor();
            services.push(tempService);
        } else if (accessory.context.type === 'lightbulb') {
            const lightService = new Homebridge.hap.Service.Lightbulb();
            services.push(lightService);

            if (accessory.context.features && (accessory.context.features.hasLevelControl || accessory.context.features.hasDimmer)) {
                lightService.getCharacteristic(Homebridge.hap.Characteristic.Brightness);
            }
        }
        
        // Add additional services based on capabilities
        if ((functionbitmask & 32) && accessory.context.type !== 'temperaturesensor') {
            // Add temperature sensor as secondary service
            const tempService = new Homebridge.hap.Service.TemperatureSensor();
            services.push(tempService);
        }
        
        // Store services on accessory
        accessory.services = services;
        
        return services;
    },
    
    // Enhanced outlet accessory creation with dynamic services
    addOrUpdateOutletAccessory: function(ain) {
        const device = this.getDevice(ain);
        const functionbitmask = device.functionbitmask || 0;
        const uuid = Homebridge.hap.uuid.generate('outlet-' + ain);
        let accessory = this.accessories.find(acc => acc.UUID === uuid);
        
        if (!accessory) {
            // Create new accessory
            const name = device.name || ain;
            accessory = new PlatformAccessory(name, uuid, Homebridge.hap.Categories.OUTLET);
            accessory.context.ain = ain;
            accessory.context.type = 'outlet';
            accessory.context.functionbitmask = functionbitmask;
            accessory.context.features = device.features || {};
            
            // Store device info in context
            if (device.manufacturer) accessory.context.manufacturer = device.manufacturer;
            if (device.productname) accessory.context.productname = device.productname;
            if (device.fwversion) accessory.context.fwversion = device.fwversion;
            
            this.setupOutletAccessory(accessory);
            this.api.registerPlatformAccessories("homebridge-fritz-new", "FRITZ!Box", [accessory]);
            this.accessories.push(accessory);
            this.log("Added outlet accessory: " + name);
        } else {
            // Update existing
            accessory.reachable = true;
            accessory.displayName = device.name || ain;
            accessory.context.functionbitmask = functionbitmask;
            accessory.context.features = device.features || {};
            
            // Update device info in context
            if (device.manufacturer) accessory.context.manufacturer = device.manufacturer;
            if (device.productname) accessory.context.productname = device.productname;
            if (device.fwversion) accessory.context.fwversion = device.fwversion;
            
            // Update services based on new functionbitmask
            this.updateAccessoryServices(accessory);
            
            this.api.updatePlatformAccessories([accessory]);
        }
    },
    
    // Update accessory services based on functionbitmask changes
    updateAccessoryServices: function(accessory) {
        const functionbitmask = accessory.context.functionbitmask || 0;
        const instance = this.accessoryInstances.get(accessory.UUID);
        
        if (!instance) return;
        
        // For outlets, check if we need to add/remove temperature service
        if (accessory.context.type === 'outlet') {
            const hasTemp = (functionbitmask & 32) !== 0;
            const tempService = accessory.getService(this.api.hap.Service.TemperatureSensor);
            
            if (hasTemp && !tempService && this.deviceConfig(`${accessory.context.ain}.TemperatureSensor`, true)) {
                // Add temperature service
                const tempService = accessory.addService(this.api.hap.Service.TemperatureSensor, accessory.displayName);
                tempService.getCharacteristic(this.api.hap.Characteristic.CurrentTemperature)
                    .setProps({minValue: -50})
                    .on('get', instance.getCurrentTemperature.bind(instance));
                    
                instance.services.TemperatureSensor = tempService;
            } else if (!hasTemp && tempService) {
                // Remove temperature service
                accessory.removeService(tempService);
                delete instance.services.TemperatureSensor;
            }
            
            // Check for power meter capability
            const hasPower = (functionbitmask & 65536) !== 0;
            const outletService = accessory.getService(this.api.hap.Service.Outlet);
            
            if (hasPower && outletService) {
                // Ensure power characteristics are added
                if (!outletService.getCharacteristic(FritzPlatform.PowerUsage)) {
                    outletService.addCharacteristic(new FritzPlatform.PowerUsage());
                }
                if (!outletService.getCharacteristic(FritzPlatform.EnergyConsumption)) {
                    outletService.addCharacteristic(new FritzPlatform.EnergyConsumption());
                }
                if (!outletService.getCharacteristic(FritzPlatform.Voltage)) {
                    outletService.addCharacteristic(new FritzPlatform.Voltage());
                }
            }
        }

        if (accessory.context.type === 'lightbulb') {
            const lightService = accessory.getService(this.api.hap.Service.Lightbulb);
            const hasBrightness = accessory.context.features && (accessory.context.features.hasLevelControl || accessory.context.features.hasDimmer);

            if (lightService && hasBrightness && !lightService.testCharacteristic(this.api.hap.Characteristic.Brightness)) {
                lightService.addCharacteristic(this.api.hap.Characteristic.Brightness);
                lightService.getCharacteristic(this.api.hap.Characteristic.Brightness)
                    .on('get', instance.getBrightness.bind(instance))
                    .on('set', instance.setBrightness.bind(instance));
            }

            if (instance.services) {
                instance.services.Lightbulb = lightService;
            }
        }
        
        // For thermostats, ensure BatteryService exists
        if (accessory.context.type === 'thermostat') {
            const BatteryService = this.api.hap.Service.BatteryService || this.api.hap.Service.Battery;
            const batteryService = BatteryService ? accessory.getService(BatteryService) : null;
            
            if (BatteryService && !batteryService) {
                this.log.debug(`Adding missing BatteryService to thermostat ${accessory.displayName}`);
                const newBatteryService = accessory.addService(BatteryService, accessory.displayName);
                
                // Set up the characteristics
                newBatteryService.getCharacteristic(this.api.hap.Characteristic.BatteryLevel)
                    .on('get', instance.getBatteryLevel.bind(instance));
                    
                newBatteryService.getCharacteristic(this.api.hap.Characteristic.ChargingState)
                    .on('get', instance.getChargingState.bind(instance));
                    
                newBatteryService.getCharacteristic(this.api.hap.Characteristic.StatusLowBattery)
                    .on('get', instance.getStatusLowBattery.bind(instance));
                
                // Update instance services reference
                if (instance.services) {
                    instance.services.BatteryService = newBatteryService;
                }
                
                // Initialize battery state
                newBatteryService.fritzBatteryLevel = 100;
                newBatteryService.fritzStatusLowBattery = this.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
                
                // WICHTIG: Initial values für HomeKit setzen!
                newBatteryService.getCharacteristic(this.api.hap.Characteristic.BatteryLevel).updateValue(100);
                newBatteryService.getCharacteristic(this.api.hap.Characteristic.StatusLowBattery)
                    .updateValue(this.api.hap.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
                
                this.log.info(`BatteryService added to ${accessory.displayName}`);
            } else if (!BatteryService) {
                this.log.warn(`BatteryService is not available for thermostat ${accessory.displayName}`);
            }
        }
    }
};
/**
 * Fritz!Box API Implementation
 * 
 * Modern replacement for fritzapi using axios
 * Implements only the methods actually used by homebridge-fritz-new
 */

const axios = require('axios');
const crypto = require('crypto');
const xml2js = require('xml2js');
const querystring = require('querystring');
const https = require('https');

/**
 * Custom error class for offline devices
 */
class DeviceOfflineError extends Error {
    constructor(message = 'Device is offline or returned invalid data') {
        super(message);
        this.name = 'DeviceOfflineError';
        this.isDeviceOffline = true;
    }
}

class FritzApi {
    constructor(log) {
        this.log = log || console.log.bind(console);
        this.parser = new xml2js.Parser({
            explicitArray: false,
            mergeAttrs: true,
            normalizeTags: true,
            explicitRoot: false
        });
        // Store session data
        this.sessionData = {
            sid: null,
            username: null,
            password: null,
            options: null,
            lastLogin: null
        };
        // Store platform reference
        this.platform = null;
        // Login concurrency protection
        this.loginPromise = null;
        
        // Command Queue for rate limiting
        this.commandQueue = [];
        this.isProcessingQueue = false;
        this.queueDelay = 25; // Reduced from 100ms to 25ms for faster response
        this.lastCommandTime = 0;
    }
    
    /**
     * Initialize with platform instance
     */
    init(platformInstance) {
        this.platform = platformInstance;
        this.log = platformInstance.log;
        this.log.debug('FRITZ!Box API module initialized');
    }

    /**
     * Calculate MD5 hash
     */
    md5(value) {
        return crypto.createHash('md5').update(value, 'utf16le').digest('hex');
    }

    /**
     * Get a new session ID with automatic session reuse
     */
    async getSessionID(username, password, options = {}) {
        // Check if login is already in progress
        if (this.loginPromise) {
            this.log.debug('Login already in progress, waiting for existing login...');
            try {
                return await this.loginPromise;
            } catch (error) {
                // If the concurrent login failed, we'll try our own login below
                this.log.debug('Concurrent login failed, attempting new login');
            }
        }
        
        // Check if we have a valid stored session
        if (this.sessionData.sid && 
            this.sessionData.username === username && 
            this.sessionData.password === password &&
            this.sessionData.lastLogin && 
            (Date.now() - this.sessionData.lastLogin) < 3600000) { // 1 hour
            
            // Verify session is still valid
            try {
                const isValid = await this.verifySession(this.sessionData.sid, options);
                if (isValid) {
                    return this.sessionData.sid;
                }
            } catch (error) {
                // Session invalid, continue with new login
            }
        }
        const url = options.url || 'http://fritz.box';
        
        // Configure axios for HTTPS with self-signed certificates
        const axiosConfig = {
            timeout: options.timeout || 10000
        };
        
        if (url.startsWith('https://')) {
            axiosConfig.httpsAgent = new https.Agent({
                rejectUnauthorized: false
            });
        }
        
        // Create login promise to prevent concurrent logins
        this.loginPromise = (async () => {
            try {
                // Step 1: Get challenge
                const challengeResponse = await axios.get(`${url}/login_sid.lua`, axiosConfig);
                
                const challengeData = await this.parser.parseStringPromise(challengeResponse.data);
                
                if (challengeData.sid && challengeData.sid !== '0000000000000000') {
                    this.loginPromise = null;
                    return challengeData.sid;
                }
                
                const challenge = challengeData.challenge;
                
                // Step 2: Calculate response
                const responseHash = this.md5(`${challenge}-${password}`);
                const response = `${challenge}-${responseHash}`;
                
                // Step 3: Login with response
                const loginResponse = await axios.get(`${url}/login_sid.lua`, {
                    ...axiosConfig,
                    params: {
                        username: username || '',
                        response: response
                    }
                });
                
                const loginData = await this.parser.parseStringPromise(loginResponse.data);
                
                if (!loginData.sid || loginData.sid === '0000000000000000') {
                    throw new Error('Invalid credentials');
                }
                
                // Store session data for reuse
                this.sessionData = {
                    sid: loginData.sid,
                    username: username,
                    password: password,
                    options: options,
                    lastLogin: Date.now()
                };
                
                this.loginPromise = null;
                return loginData.sid;
            } catch (error) {
                this.loginPromise = null;
                if (error.response) {
                    error.response.statusCode = error.response.status;
                }
                throw error;
            }
        })();
        
        return this.loginPromise;
    }

    /**
     * Verify if a session is still valid
     */
    async verifySession(sid, options = {}) {
        try {
            const response = await this.apiCall(sid, '/webservices/homeautoswitch.lua', {
                switchcmd: 'getswitchlist'
            }, options);
            
            // If we get a valid response, session is good
            return response && !response.includes('0000000000000000');
        } catch (error) {
            return false;
        }
    }
    
    /**
     * Clear stored session
     */
    clearSession() {
        this.sessionData = {
            sid: null,
            username: null,
            password: null,
            options: null,
            lastLogin: null
        };
        this.loginPromise = null;
    }
    
    /**
     * Make an authenticated API call
     */
    async apiCall(sid, path, params = {}, options = {}) {
        const url = options.url || 'http://fritz.box';
        const fullUrl = `${url}${path}`;
        const requestParams = {
            sid: sid,
            ...params
        };
        
        // Configure axios request options
        const axiosConfig = {
            params: requestParams,
            timeout: options.timeout || 15000
        };
        
        // Add HTTPS agent for self-signed certificates if using HTTPS
        if (fullUrl.startsWith('https://')) {
            axiosConfig.httpsAgent = new https.Agent({
                rejectUnauthorized: false
            });
        }
        
        try {
            const response = await axios.get(fullUrl, axiosConfig);
            
            // Check if we got redirected (indicates invalid session)
            if (response.request && response.request.res && response.request.res.responseUrl) {
                const finalUrl = response.request.res.responseUrl;
                if (finalUrl.includes('login_sid.lua') || finalUrl.includes('login.lua')) {
                    throw new Error('Session invalid - authentication required');
                }
            }
            
            // Check for invalid responses that indicate session problems
            const responseData = typeof response.data === 'string' ? response.data.trim() : response.data;
            
            // Special case: sethkrtsoll with param=off/on can return empty response which is OK
            const isSetTempCommand = params.switchcmd === 'sethkrtsoll' && 
                                   (params.param === 'off' || params.param === 'on');
            
            // Only treat empty response as error if it's not a valid off/on command
            if (responseData === '0000000000000000') {
                const error = new Error(`API returned invalid session indicator: '${responseData}'`);
                error.isSidError = true;
                throw error;
            } else if (responseData === '' && !isSetTempCommand) {
                const error = new Error(`API returned empty response`);
                error.isSidError = true;
                throw error;
            }
            
            return response.data;
        } catch (error) {
            if (error.response) {
                error.response.statusCode = error.response.status;
                // Check for 403 Forbidden (indicates invalid session)
                if (error.response.status === 403) {
                    error.isSidError = true;
                }
            }
            throw error;
        }
    }
    
    /**
     * Add command to queue and process
     */
    async queueCommand(executor) {
        return new Promise((resolve, reject) => {
            this.commandQueue.push({ executor, resolve, reject });
            this.processQueue();
        });
    }
    
    /**
     * Process command queue with rate limiting
     */
    async processQueue() {
        if (this.isProcessingQueue || this.commandQueue.length === 0) {
            return;
        }
        
        this.isProcessingQueue = true;
        
        while (this.commandQueue.length > 0) {
            const { executor, resolve, reject } = this.commandQueue.shift();
            
            // Enforce minimum delay between commands
            const now = Date.now();
            const timeSinceLastCommand = now - this.lastCommandTime;
            if (timeSinceLastCommand < this.queueDelay) {
                await new Promise(r => setTimeout(r, this.queueDelay - timeSinceLastCommand));
            }
            
            try {
                const result = await executor();
                this.lastCommandTime = Date.now();
                resolve(result);
            } catch (error) {
                this.lastCommandTime = Date.now();
                reject(error);
            }
        }
        
        this.isProcessingQueue = false;
    }
    
    /**
     * Make request with automatic session renewal
     */
    async makeRequest(command, ain, options = {}) {
        if (!this.platform) {
            throw new Error('FRITZ!Box API not initialized. Call init() first.');
        }
        
        // Ensure we have a session
        if (!this.platform.sid) {
            this.log.info('No session available. Performing initial login.');
            const sid = await this.getSessionID(
                this.platform.config.username,
                this.platform.config.password,
                this.platform.options || {}
            );
            this.platform.sid = sid;
        }
        
        // Queue the command execution
        return this.queueCommand(async () => {
            try {
                // Build the appropriate API call based on command
                const methodName = this.getMethodForCommand(command);
                if (!methodName || !this[methodName]) {
                    throw new Error(`Unknown command: ${command}`);
                }
                
                // Call the appropriate method with platform options merged
                const mergedOptions = { ...this.platform.options, ...options };
                
                // Special handling for commands that use a value argument before options
                if (methodName === 'setTempTarget' || command === 'setTempTarget' ||
                    methodName === 'setSimpleOnOff' || command === 'setSimpleOnOff' ||
                    methodName === 'setLevel' || command === 'setLevel' ||
                    methodName === 'setLevelPercentage' || command === 'setLevelPercentage') {
                    const commandValue = options;
                    const realOptions = this.platform.options || {};

                    return await this[methodName](this.platform.sid, ain, commandValue, realOptions);
                }
                
                return await this[methodName](this.platform.sid, ain, mergedOptions);
            } catch (error) {
                // Check if this is a session error
                const isSidError = error.isSidError || 
                                  (error.response && error.response.status === 403) ||
                                  (error.code === 'ECONNABORTED') ||
                                  (error.code === 'ETIMEDOUT') ||
                                  (error.message && error.message.includes('Session invalid'));
                
                if (isSidError && !options.isRetry) {
                    this.log.warn(`API call failed with session error (${error.code || error.message}). Re-authenticating...`);
                    
                    // Clear the invalid session
                    this.clearSession();
                    this.platform.sid = null;
                    
                    // Get new session - this will use loginPromise if one is already running
                    const sid = await this.getSessionID(
                        this.platform.config.username,
                        this.platform.config.password,
                        this.platform.options || {}
                    );
                    this.platform.sid = sid;
                    
                    this.log.info('Re-authentication successful. Retrying original request...');
                    
                    // Retry the call ONCE with isRetry flag to prevent infinite loop
                    options.isRetry = true;
                    return await this.makeRequest(command, ain, options);
                } else {
                    // Re-throw non-session errors
                    throw error;
                }
            }
        });
    }
    
    /**
     * Map command names to method names
     */
    getMethodForCommand(command) {
        const commandMap = {
            'getswitchstate': 'getSwitchState',
            'setswitchon': 'setSwitchOn',
            'setswitchoff': 'setSwitchOff',
            'setsimpleonoff': 'setSimpleOnOff',
            'getswitchpower': 'getSwitchPower',
            'getswitchenergy': 'getSwitchEnergy',
            'setlevel': 'setLevel',
            'setlevelpercentage': 'setLevelPercentage',
            'gettemperature': 'getTemperature',
            'gethkrtsoll': 'getTempTarget',
            'getTempTarget': 'getTempTarget',
            'sethkrtsoll': 'setTempTarget',
            'setTempTarget': 'setTempTarget',
            'getbatterycharge': 'getBatteryCharge',
            'getBatteryCharge': 'getBatteryCharge',
            'getdeviceinfos': 'getDeviceInfos',
            'getDeviceInfos': 'getDeviceInfos'
        };
        return commandMap[command] || command;
    }

    /**
     * Get device list
     */
    async getDeviceList(sid, options = {}) {
        if (options.log) {
            options.log.debug('> getDeviceList called with sid:', sid ? sid.substring(0, 8) + '...' : 'undefined');
        }
        try {
            const response = await this.apiCall(sid, '/webservices/homeautoswitch.lua', {
                switchcmd: 'getdevicelistinfos'  // FIX: Case-sensitive - must be lowercase
            }, options);
            
            // Check if response is an error page or redirect
            if (typeof response === 'string') {
                if (response.includes('<!DOCTYPE') || response.includes('<html')) {
                    throw new Error('Invalid response - received HTML instead of device list XML');
                }
                
                if (response.includes('0000000000000000')) {
                    throw new Error('Invalid session - authentication required');
                }
            }
            
            const data = await this.parser.parseStringPromise(response);
            
            // Try different possible data structures
            let devices = [];
            
            // With explicitRoot: false, the parser removes the root element
            // So <devicelist><device>...</device></devicelist> becomes { device: ... }
            // Check for data.device (this is the normal case with explicitRoot: false)
            if (data && data.device) {
                devices = Array.isArray(data.device) ? data.device : [data.device];
            }
            // FALLBACK: Check for devicelist.device (in case explicitRoot is true)
            else if (data && data.devicelist && data.devicelist.device) {
                devices = Array.isArray(data.devicelist.device) ? data.devicelist.device : [data.devicelist.device];
            }
            // EDGE CASE: Empty device list - data will just have version attribute
            else if (data && data.version && !data.device) {
                devices = [];
            }
            else {
                // Unexpected structure, return empty array
                devices = [];
            }
            
            return devices.map(device => this.normalizeDevice(device));
        } catch (error) {
            // Create more descriptive error
            const detailedError = new Error(
                `getDeviceList failed: ${error.message || 'Unknown error'}` +
                (error.response ? ` (HTTP ${error.response.status})` : '')
            );
            detailedError.originalError = error;
            throw detailedError;
        }
    }

    /**
     * Get filtered device list
     */
    async getDeviceListFiltered(sid, filter = {}, options = {}) {
        const devices = await this.getDeviceList(sid, options);
        
        if (filter.identifier) {
            const ain = filter.identifier.replace(/\s/g, '');
            return devices.filter(device => 
                device.identifier.replace(/\s/g, '') === ain
            );
        }
        
        return devices;
    }

    /**
     * Get list of switches/outlets
     */
    async getSwitchList(sid, options = {}) {
        const devices = await this.getDeviceList(sid, options);
        return devices
            .filter(device => device.switch)
            .map(device => device.identifier.replace(/\s/g, ''));
    }

    /**
     * Get list of thermostats
     */
    async getThermostatList(sid, options = {}) {
        const devices = await this.getDeviceList(sid, options);
        return devices
            .filter(device => device.hkr)
            .map(device => device.identifier.replace(/\s/g, ''));
    }

    /**
     * Get switch state
     */
    async getSwitchState(sid, ain, options = {}) {
        const response = await this.apiCall(sid, '/webservices/homeautoswitch.lua', {
            ain: ain,
            switchcmd: 'getswitchstate'
        }, options);
        
        return response.toString().trim() === '1';
    }

    /**
     * Turn switch on
     */
    async setSwitchOn(sid, ain, options = {}) {
        const response = await this.apiCall(sid, '/webservices/homeautoswitch.lua', {
            ain: ain,
            switchcmd: 'setswitchon'
        }, options);
        
        return response.toString().trim() === '1';
    }

    /**
     * Turn switch off
     */
    async setSwitchOff(sid, ain, options = {}) {
        const response = await this.apiCall(sid, '/webservices/homeautoswitch.lua', {
            ain: ain,
            switchcmd: 'setswitchoff'
        }, options);
        
        return response.toString().trim() === '1';
    }

    /**
     * Set simple on/off state for light devices
     */
    async setSimpleOnOff(sid, ain, onoff, options = {}) {
        const response = await this.apiCall(sid, '/webservices/homeautoswitch.lua', {
            ain: ain,
            switchcmd: 'setsimpleonoff',
            onoff: String(onoff)
        }, options);

        return response ? response.toString().trim() : '';
    }

    /**
     * Set raw light level (0-255)
     */
    async setLevel(sid, ain, level, options = {}) {
        const response = await this.apiCall(sid, '/webservices/homeautoswitch.lua', {
            ain: ain,
            switchcmd: 'setlevel',
            level: String(level)
        }, options);

        return response ? response.toString().trim() : '';
    }

    /**
     * Set light level as percentage (0-100)
     */
    async setLevelPercentage(sid, ain, level, options = {}) {
        const response = await this.apiCall(sid, '/webservices/homeautoswitch.lua', {
            ain: ain,
            switchcmd: 'setlevelpercentage',
            level: String(level)
        }, options);

        return response ? response.toString().trim() : '';
    }

    /**
     * Get switch power consumption
     */
    async getSwitchPower(sid, ain, options = {}) {
        const response = await this.apiCall(sid, '/webservices/homeautoswitch.lua', {
            ain: ain,
            switchcmd: 'getswitchpower'
        }, options);
        
        const power = parseInt(response.toString().trim());
        return isNaN(power) ? 0 : power / 1000; // Convert mW to W
    }

    /**
     * Get switch energy consumption
     */
    async getSwitchEnergy(sid, ain, options = {}) {
        const response = await this.apiCall(sid, '/webservices/homeautoswitch.lua', {
            ain: ain,
            switchcmd: 'getswitchenergy'
        }, options);
        
        const energy = parseInt(response.toString().trim());
        return isNaN(energy) ? 0 : energy / 1000; // Convert Wh to kWh
    }

    /**
     * Get temperature
     */
    async getTemperature(sid, ain, options = {}) {
        const response = await this.apiCall(sid, '/webservices/homeautoswitch.lua', {
            ain: ain,
            switchcmd: 'gettemperature'
        }, options);
        
        const responseStr = response.toString().trim();
        // 'inval' means this device doesn't support temperature reading
        if (responseStr === 'inval' || responseStr === 'invalid') {
            return null;
        }
        
        const temp = parseInt(responseStr);
        return isNaN(temp) ? null : temp / 10; // Convert to degrees Celsius
    }

    /**
     * Get target temperature
     */
    async getTempTarget(sid, ain, options = {}) {
        const response = await this.apiCall(sid, '/webservices/homeautoswitch.lua', {
            ain: ain,
            switchcmd: 'gethkrtsoll'
        }, options);
        
        const responseStr = response.toString().trim();
        // 'inval' means this device doesn't support temperature target (not a thermostat)
        if (responseStr === 'inval' || responseStr === 'invalid') {
            return null;
        }
        
        const temp = parseInt(responseStr);
        if (isNaN(temp) || temp === 253) return 'off';
        if (temp === 254) return 'on';
        
        return temp / 2; // Convert 0.5°C units to °C
    }

    /**
     * Set target temperature
     */
    async setTempTarget(sid, ain, temperature, options = {}) {
        let param;
        
        if (temperature === 'on') {
            param = "254"; // ON mode
        } else if (temperature === 'off') {
            param = "253"; // OFF mode - use string "253" as confirmed by tests
        } else {
            // Ensure temperature is a number and convert °C to 0.5°C units
            // Handle both comma and dot as decimal separator
            const tempString = String(temperature).replace(',', '.');
            const tempNumber = parseFloat(tempString);
            if (isNaN(tempNumber)) {
                this.log.error(`setTempTarget: Invalid temperature value: ${temperature}`);
                throw new Error(`Invalid temperature value: ${temperature}`);
            }
            
            // Apply temperature limits: 8-28°C
            if (tempNumber < 8) {
                this.log.debug(`setTempTarget: Temperature ${tempNumber}°C below minimum, setting to OFF`);
                param = "253"; // OFF
            } else if (tempNumber > 28) {
                this.log.debug(`setTempTarget: Temperature ${tempNumber}°C above maximum, setting to ON`);
                param = "254"; // ON (Max)
            } else {
                param = String(Math.round(tempNumber * 2));
            }
        }
        
        this.log.debug(`setTempTarget: AIN=${ain}, temperature=${temperature}, param=${param}`);
        
        try {
            const response = await this.apiCall(sid, '/webservices/homeautoswitch.lua', {
                ain: ain,
                switchcmd: 'sethkrtsoll',
                param: param
            }, options);
            
            return response;
        } catch (error) {
            this.log.error(`setTempTarget failed: AIN=${ain}, param=${param}, error:`, error.response ? error.response.data : error.message);
            throw error;
        }
    }

    /**
     * Get device infos for a single device
     */
    async getDeviceInfos(sid, ain, options = {}) {
        try {
            const response = await this.apiCall(sid, '/webservices/homeautoswitch.lua', {
                ain: ain,
                switchcmd: 'getdeviceinfos'
            }, options);
            
            const data = await this.parser.parseStringPromise(response);
            return this.normalizeDevice(data);
        } catch (error) {
            throw error;
        }
    }

    /**
     * Get battery charge
     */
    async getBatteryCharge(sid, ain, options = {}) {
        try {
            // Use getdeviceinfos for single device query (more efficient)
            const device = await this.getDeviceInfos(sid, ain, options);
            
            // Check battery in device root first (as seen in test results)
            if (device.battery !== undefined) {
                return parseInt(device.battery) || 0;
            }
            
            // Then check in HKR element (thermostats)
            if (device.hkr && device.hkr.battery !== undefined) {
                return parseInt(device.hkr.battery) || 0;
            }
            
            // No battery info means it's likely a mains-powered device
            return 100; // Default if no battery info
        } catch (error) {
            // If the device doesn't support battery status, return default
            if (error.message && (error.message.includes('inval') || error.message.includes('invalid'))) {
                return 100;
            }
            // Log error but don't throw - battery is not critical
            this.log.debug(`getBatteryCharge error for ${ain}: ${error.message}`);
            return 100;
        }
    }

    /**
     * Get OS version
     */
    async getOSVersion(sid, options = {}) {
        // This requires TR-064, for now return a placeholder
        // In a full implementation, this would use TR-064 GetInfo action
        return 'FRITZ!OS';
    }

    /**
     * Get guest WLAN status
     */
    async getGuestWlan(sid, options = {}) {
        const url = options.url || 'http://fritz.box';
        
        // Configure axios for HTTPS with self-signed certificates
        const axiosConfig = {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: options.timeout || 10000
        };
        
        if (url.startsWith('https://')) {
            axiosConfig.httpsAgent = new https.Agent({
                rejectUnauthorized: false
            });
        }
        
        try {
            const response = await axios.post(`${url}/data.lua`, 
                querystring.stringify({
                    sid: sid,
                    page: 'wGuest',
                    xhr: 1
                }), 
                axiosConfig
            );
            
            const data = response.data;
            return data && data.data && data.data.active === '1';
        } catch (error) {
            if (error.response) {
                error.response.statusCode = error.response.status;
            }
            throw error;
        }
    }

    /**
     * Set guest WLAN status
     */
    async setGuestWlan(sid, enable, options = {}) {
        const url = options.url || 'http://fritz.box';
        
        // Configure axios for HTTPS with self-signed certificates
        const axiosConfig = {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: options.timeout || 10000
        };
        
        if (url.startsWith('https://')) {
            axiosConfig.httpsAgent = new https.Agent({
                rejectUnauthorized: false
            });
        }
        
        try {
            const response = await axios.post(`${url}/data.lua`, 
                querystring.stringify({
                    sid: sid,
                    page: 'wGuest',
                    active: enable ? '1' : '0',
                    xhr: 1,
                    apply: ''
                }), 
                axiosConfig
            );
            
            return true;
        } catch (error) {
            if (error.response) {
                error.response.statusCode = error.response.status;
            }
            throw error;
        }
    }

    /**
     * Parse device features from XML structure (XML-First approach)
     * Ignores unreliable functionbitmask and checks actual XML elements
     */
    parseDeviceFeatures(bitmask, device) {
        // Start with empty features - we'll detect from XML
        const features = {};
        
        // Check for actual XML elements present in device
        if (device) {
            // Standard features based on XML elements
            features.hasTemperature = !!device.temperature;
            features.hasSwitch = !!device.switch;
            features.hasPowermeter = !!device.powermeter;
            features.hasThermostat = !!device.hkr;
            features.hasAlarm = !!device.alert;
            features.hasButton = !!device.button;
            features.hasHumidity = !!device.humidity;
            
            // Color/Level control for lights
            features.hasColorControl = !!device.colorcontrol;
            features.hasLevelControl = !!device.levelcontrol;
            features.hasDimmer = features.hasLevelControl || features.hasColorControl;
            
            // Blind/Shutter control
            features.hasBlind = !!device.blind;
            
            // Battery detection - check multiple sources
            features.hasBattery = false;
            if (device.battery && device.present === '1') {
                features.hasBattery = true;
            } else if (device.hkr && device.hkr.battery !== undefined && device.present === '1') {
                features.hasBattery = true;
            }
            
            // Future-proof: Check for unknown elements
            features.unknownElements = [];
            const knownElements = ['identifier', 'id', 'functionbitmask', 'fwversion', 
                                 'manufacturer', 'productname', 'present', 'name', 
                                 'txbusy', 'battery', 'batterylow',
                                 'temperature', 'switch', 'powermeter', 'hkr', 
                                 'alert', 'button', 'humidity', 'colorcontrol', 
                                 'levelcontrol', 'blind', 'simpleonoff'];
            
            Object.keys(device).forEach(key => {
                if (!knownElements.includes(key) && typeof device[key] === 'object') {
                    features.unknownElements.push(key);
                    // Dynamically add feature flag
                    features[`has${key.charAt(0).toUpperCase() + key.slice(1)}`] = true;
                }
            });
            
            // Log unknown elements for future development
            if (features.unknownElements.length > 0) {
                this.log(`Device ${device.identifier} has unknown elements: ${features.unknownElements.join(', ')}`);
            }
        }
        
        // LEGACY: Still check bitmask for devices that might not have XML elements yet
        // This ensures backward compatibility
        if (!features.hasSwitch && (bitmask & 512) !== 0) {
            features.hasSwitch = true;
        }
        if (!features.hasThermostat &&
            !features.hasDimmer &&
            (bitmask & 8192) !== 0) {
            features.hasThermostat = true;
        }
        
        return features;
    }

    /**
     * Normalize device structure
     */
    normalizeDevice(device) {
        const normalized = {
            identifier: device.identifier || '',
            id: device.id || '',
            fwversion: device.fwversion || '',
            manufacturer: device.manufacturer || '',
            productname: device.productname || '',
            present: device.present === '1',
            name: device.name || '',
            functionbitmask: parseInt(device.functionbitmask) || 0
        };

        // Temperature sensor
        if (device.temperature) {
            normalized.temperature = {
                celsius: parseInt(device.temperature.celsius) / 10 || 0,
                offset: parseInt(device.temperature.offset) / 10 || 0
            };
        }

        // Switch
        if (device.switch) {
            normalized.switch = {
                state: device.switch.state === '1',
                mode: device.switch.mode || '',
                lock: device.switch.lock === '1',
                devicelock: device.switch.devicelock === '1'
            };
        }

        // Power meter
        if (device.powermeter) {
            normalized.powermeter = {
                power: parseInt(device.powermeter.power) / 1000 || 0,
                energy: parseInt(device.powermeter.energy) || 0
            };
            // Add voltage if available (in millivolts from API)
            if (device.powermeter.voltage) {
                normalized.powermeter.voltage = parseInt(device.powermeter.voltage) / 1000 || 0;
            }
        }

        // Thermostat (HKR)
        if (device.hkr) {
            normalized.hkr = {
                tist: parseInt(device.hkr.tist) / 2 || 0,
                tsoll: parseInt(device.hkr.tsoll) / 2 || 0,
                absenk: parseInt(device.hkr.absenk) / 2 || 0,
                komfort: parseInt(device.hkr.komfort) / 2 || 0,
                lock: device.hkr.lock === '1',
                devicelock: device.hkr.devicelock === '1',
                battery: parseInt(device.hkr.battery) || 0,
                batterylow: device.hkr.batterylow === '1'
            };
            
            // Extended HKR features
            if (device.hkr.boostactive !== undefined) {
                normalized.hkr.boostactive = device.hkr.boostactive === '1';
            }
            if (device.hkr.boostactiveendtime !== undefined) {
                normalized.hkr.boostactiveendtime = parseInt(device.hkr.boostactiveendtime) || 0;
            }
            if (device.hkr.windowopenactive !== undefined) {
                normalized.hkr.windowopenactive = device.hkr.windowopenactive === '1';
            }
            if (device.hkr.windowopenactiveendtime !== undefined) {
                normalized.hkr.windowopenactiveendtime = parseInt(device.hkr.windowopenactiveendtime) || 0;
            }
            if (device.hkr.adaptiveheatingactive !== undefined) {
                normalized.hkr.adaptiveheatingactive = device.hkr.adaptiveheatingactive === '1';
            }
            if (device.hkr.adaptiveheatingrunning !== undefined) {
                normalized.hkr.adaptiveheatingrunning = device.hkr.adaptiveheatingrunning === '1';
            }
        }

        // Battery
        if (device.battery) {
            normalized.battery = parseInt(device.battery) || 0;
            normalized.batterylow = device.batterylow === '1';
        }

        // Alert sensor
        if (device.alert) {
            normalized.alert = {
                state: device.alert.state === '1'
            };
        }

        // Button
        if (device.button) {
            const buttons = Array.isArray(device.button) ? device.button : [device.button];
            normalized.button = buttons.map(btn => ({
                id: btn.id || '',
                name: btn.name || '',
                lastpressedtimestamp: btn.lastpressedtimestamp || '0'
            }));
        }
        
        // SimpleOnOff (found in newer FRITZ!Smart Energy devices)
        if (device.simpleonoff) {
            normalized.simpleonoff = {
                state: device.simpleonoff.state === '1'
            };
            // Use simpleonoff as primary state source if available
            normalized.state = device.simpleonoff.state === '1';
        }

        // Parse device features from functionbitmask and device structure
        normalized.features = this.parseDeviceFeatures(normalized.functionbitmask, device);
        
        // Extract values from all elements (including unknown ones)
        normalized.values = this.extractAllValues(device);

        return normalized;
    }
    
    /**
     * Extract values from all device elements (future-proof approach)
     */
    extractAllValues(device) {
        const values = {};
        
        // Known element extractors
        const extractors = {
            temperature: (elem) => ({
                celsius: elem.celsius ? parseInt(elem.celsius) / 10 : null,
                offset: elem.offset ? parseInt(elem.offset) / 10 : 0
            }),
            humidity: (elem) => ({
                percent: elem.rel_humidity ? parseInt(elem.rel_humidity) : null
            }),
            switch: (elem) => ({
                state: elem.state === '1',
                mode: elem.mode || '',
                lock: elem.lock === '1'
            }),
            powermeter: (elem) => ({
                power: elem.power ? parseInt(elem.power) / 1000 : 0,
                energy: elem.energy ? parseInt(elem.energy) : 0,
                voltage: elem.voltage ? parseInt(elem.voltage) / 1000 : null
            }),
            hkr: (elem) => ({
                currentTemp: elem.tist ? parseInt(elem.tist) / 2 : null,
                targetTemp: elem.tsoll ? parseInt(elem.tsoll) / 2 : null,
                battery: elem.battery ? parseInt(elem.battery) : null,
                valve: elem.valve ? parseInt(elem.valve) : null
            }),
            alert: (elem) => ({
                state: elem.state === '1'
            }),
            colorcontrol: (elem) => ({
                hue: elem.hue ? parseInt(elem.hue) : null,
                saturation: elem.saturation ? parseInt(elem.saturation) : null,
                temperature: elem.temperature ? parseInt(elem.temperature) : null
            }),
            levelcontrol: (elem) => ({
                level: elem.level ? parseInt(elem.level) : null,
                levelpercentage: elem.levelpercentage ? parseInt(elem.levelpercentage) : null
            })
        };
        
        // Process all device elements
        Object.keys(device).forEach(key => {
            const element = device[key];
            
            // Skip non-object values and metadata
            if (typeof element !== 'object' || !element) return;
            
            if (extractors[key]) {
                // Use specific extractor for known elements
                values[key] = extractors[key](element);
            } else if (!['identifier', 'id', 'functionbitmask', 'fwversion', 
                       'manufacturer', 'productname', 'present', 'name', 
                       'txbusy', 'battery', 'batterylow', 'simpleonoff'].includes(key)) {
                // Generic extraction for unknown elements
                values[key] = {};
                Object.entries(element).forEach(([subKey, subValue]) => {
                    // Try to parse numeric values
                    if (!isNaN(subValue)) {
                        values[key][subKey] = parseFloat(subValue);
                    } else {
                        values[key][subKey] = subValue;
                    }
                });
            }
        });
        
        return values;
    }
}

// Export singleton instance with same interface as original fritzapi
// Create new instance for each require to avoid session conflicts
let api = null;

function getApi() {
    if (!api) {
        api = new FritzApi();
    }
    return api;
}

module.exports = {
    init: (platform) => getApi().init(platform),
    makeRequest: (command, ain, options) => getApi().makeRequest(command, ain, options),
    getSessionID: (username, password, options) => getApi().getSessionID(username, password, options),
    getDeviceList: (sid, options) => getApi().getDeviceList(sid, options),
    getDeviceListFiltered: (sid, filter, options) => getApi().getDeviceListFiltered(sid, filter, options),
    getSwitchList: (sid, options) => getApi().getSwitchList(sid, options),
    getThermostatList: (sid, options) => getApi().getThermostatList(sid, options),
    getSwitchState: (sid, ain, options) => getApi().getSwitchState(sid, ain, options),
    setSwitchOn: (sid, ain, options) => getApi().setSwitchOn(sid, ain, options),
    setSwitchOff: (sid, ain, options) => getApi().setSwitchOff(sid, ain, options),
    setSimpleOnOff: (sid, ain, onoff, options) => getApi().setSimpleOnOff(sid, ain, onoff, options),
    setLevel: (sid, ain, level, options) => getApi().setLevel(sid, ain, level, options),
    setLevelPercentage: (sid, ain, level, options) => getApi().setLevelPercentage(sid, ain, level, options),
    getSwitchPower: (sid, ain, options) => getApi().getSwitchPower(sid, ain, options),
    getSwitchEnergy: (sid, ain, options) => getApi().getSwitchEnergy(sid, ain, options),
    getTemperature: (sid, ain, options) => getApi().getTemperature(sid, ain, options),
    getTempTarget: (sid, ain, options) => getApi().getTempTarget(sid, ain, options),
    setTempTarget: (sid, ain, temperature, options) => getApi().setTempTarget(sid, ain, temperature, options),
    getBatteryCharge: (sid, ain, options) => getApi().getBatteryCharge(sid, ain, options),
    getOSVersion: (sid, options) => getApi().getOSVersion(sid, options),
    getGuestWlan: (sid, options) => getApi().getGuestWlan(sid, options),
    setGuestWlan: (sid, enable, options) => getApi().setGuestWlan(sid, enable, options),
    // Export utility functions for testing
    clearSession: () => getApi().clearSession()
};
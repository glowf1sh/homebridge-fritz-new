'use strict';

const assert = require('assert');

class Characteristic {
    constructor(displayName, uuid) {
        this.displayName = displayName;
        this.UUID = uuid;
    }

    setProps(props) {
        this.props = props;
    }

    getDefaultValue() {
        return null;
    }
}

Characteristic.Formats = {
    FLOAT: 'float'
};
Characteristic.Perms = {
    READ: 'read',
    NOTIFY: 'notify'
};

const homebridge = {
    hap: {
        Characteristic: Characteristic
    },
    platformAccessory: function PlatformAccessory() {}
};

describe('custom power characteristics', function() {
    const FritzPlatform = require('../lib/platform')(homebridge);

    it('can be instantiated when Homebridge exposes Characteristic as a class', function() {
        const powerUsage = new FritzPlatform.PowerUsage();

        assert(powerUsage instanceof Characteristic);
        assert.strictEqual(powerUsage.UUID, 'AE48F447-E065-4B31-8050-8FB06DB9E087');
        assert.deepStrictEqual(powerUsage.props, {
            format: Characteristic.Formats.FLOAT,
            unit: 'W',
            perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
        });
    });
});

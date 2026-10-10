### Brought to you by Glowfish
Need a home for your website, project or next game night? **[Glowfish](https://www.glowfish.de)** has you covered – web hosting, vServers and game servers for Minecraft, Factorio, Valheim and more. Up and running in minutes, switch games anytime for free.

# homebridge-fritz-new - Produktionsreifer Fork mit Sicherheitsupdates

> **🎆 STABLE RELEASE 1.0.76 - Produktionsreif für FRITZ!DECT 301 und DECT 200**  
> Vollständig stabil, ohne UnhandledPromiseRejections oder Session-Errors.

## ✅ Produktionsstatus Version 1.0.76

**Offiziell stabil und produktionsreif für:**
- 🌡️ **FRITZ!DECT 301 Heizkörperregler** - Sofortige Temperaturänderungen, OFF-Mode, Batterieanzeige
- 🔌 **FRITZ!DECT 200 Steckdosen** - Schaltbare Steckdosen mit vollständiger Leistungsmessung:
  - ⚡ **Aktuelle Leistung** in Watt (wird alle 2 Minuten aktualisiert)
  - 📈 **Gesamtverbrauch** in kWh seit Inbetriebnahme
  - 🔋 **Netzspannung** in Volt
  - 🌡️ **Temperatur** am Gerät
  - ℹ️ **Hinweis**: Energiedaten sind nur in Apps wie Eve sichtbar, nicht in Apple Home (siehe FAQ)
- 📡 **Gäste-WLAN** - Ein/Aus-Schaltung
- 💡 **Alle FRITZ! Smart Home Geräte** mit HomeKit-Integration

**Gelöste Probleme in v1.0.76:**
- ✅ Thermostate reagieren jetzt sofort (keine 2-3 Minuten Wartezeit mehr)
- ✅ OFF-Mode wird korrekt in HomeKit angezeigt
- ✅ Batteriestatus für alle Thermostate sichtbar
- ✅ Konsistente Performance für alle Gerätetypen

## ⚠️ WARUM DIESER FORK EXISTIERT

> **Das originale NPM-Paket `homebridge-fritz` von @andig wird seit Jahren nicht mehr gepflegt!**  
> Letzte Aktivität: 2019 • 22 bekannte Sicherheitslücken • Keine Reaktion auf Issues/PRs
> 
> **Dieses Repository `homebridge-fritz-new` ist ein aktiv gewarteter Fork mit:**
> - ✅ Alle 24 Sicherheitslücken behoben (0 Vulnerabilities) - Stand v1.0.46
> - ✅ Kompatibilität mit aktuellen Node.js/Homebridge Versionen
> - ✅ Regelmäßige Updates und Support
> - ✅ Aktive Community-Betreuung
> - 🚀 **Deutlich höhere Performance**: Fritz!Box wird nicht mehr mit ständigen Anfragen überlastet
> - ⚡ **Intelligentes Request-Management**: Priority Queue und Request-Limiting schützen die Fritz!Box
> - 🔧 **Robuste Fehlerbehandlung**: Keine Abstürze mehr durch UnhandledPromiseRejections

### 🚀 Installation des neuen Pakets:

```bash
# Global für Homebridge UI
npm install -g homebridge-fritz-new

# Für lokale Installation
npm install homebridge-fritz-new
```

### Alternative Installation über Git:

```bash
# In Homebridge node_modules Verzeichnis wechseln
cd /var/lib/homebridge/node_modules

# Repository klonen
git clone https://github.com/glowf1sh/homebridge-fritz-new.git
cd homebridge-fritz-new

# Dependencies installieren
npm install

# Package erstellen
npm pack

# Installation (wähle eine Methode):

# Standard NPM:
npm install -g ./homebridge-fritz-new-*.tgz

# Homebridge-Service:
npm --prefix "/var/lib/homebridge" install ./homebridge-fritz-new-*.tgz

# hb-service:
hb-service add ./homebridge-fritz-new-*.tgz
```

📚 **[Detaillierte Installationsanleitung](INSTALLATION.md)** mit allen Methoden und Troubleshooting

---

[![npm version](https://img.shields.io/npm/v/homebridge-fritz-new.svg)](https://www.npmjs.com/package/homebridge-fritz-new)
[![npm downloads](https://img.shields.io/npm/dt/homebridge-fritz-new.svg)](https://www.npmjs.com/package/homebridge-fritz-new)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)
[![Homebridge Version](https://img.shields.io/badge/homebridge-%3E%3D1.3.0-brightgreen.svg)](https://homebridge.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Security](https://img.shields.io/badge/vulnerabilities-0-brightgreen.svg)](https://github.com/glowf1sh/homebridge-fritz-new/security)
[![Build Status](https://github.com/glowf1sh/homebridge-fritz-new/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/glowf1sh/homebridge-fritz-new/actions/workflows/npm-publish.yml)
[![Last Commit](https://img.shields.io/github/last-commit/glowf1sh/homebridge-fritz-new.svg)](https://github.com/glowf1sh/homebridge-fritz-new/commits/master)
[![GitHub Stars](https://img.shields.io/github/stars/glowf1sh/homebridge-fritz-new.svg?style=social)](https://github.com/glowf1sh/homebridge-fritz-new/stargazers)
[![Dependencies](https://img.shields.io/badge/dependencies-6-brightgreen.svg)](https://github.com/glowf1sh/homebridge-fritz-new/blob/master/package.json)
[![Actively Maintained](https://img.shields.io/badge/Maintained%3F-yes-green.svg)](https://github.com/glowf1sh/homebridge-fritz-new/graphs/commit-activity)

> **Dieser Fork ersetzt das veraltete [homebridge-fritz](https://github.com/andig/homebridge-fritz) Paket**, welches seit 2019 nicht mehr gewartet wird und 22 kritische Sicherheitslücken enthält.

> **WICHTIGER HINWEIS**: Dies ist ein aktiv gewarteter Fork mit allen Sicherheitsupdates und Bugfixes!

## 🔄 MIGRATION VOM ALTEN PAKET

### Schritt 1: Altes Paket deinstallieren
```bash
# Falls das alte homebridge-fritz installiert ist:
npm uninstall -g homebridge-fritz
```

### Schritt 2: Neues Paket installieren
```bash
npm install -g homebridge-fritz-new
```

### Schritt 3: Homebridge neustarten
```bash
sudo systemctl restart homebridge
# oder
homebridge
```

**Wichtig:** Die Konfiguration bleibt unverändert! Alle Einstellungen funktionieren weiterhin.

## 🎨 Installation mit Homebridge Config UI X

Wenn Sie Homebridge Config UI X verwenden:

1. Öffnen Sie die Homebridge Web-Oberfläche
2. Gehen Sie zu "Plugins" 
3. Suchen Sie nach `homebridge-fritz-new`
4. Klicken Sie auf "Install"
5. Nach der Installation: Homebridge neustarten

**Hinweis:** Falls das alte `homebridge-fritz` installiert ist, deinstallieren Sie es zuerst!

## 🎯 Produktionsstabilität erreicht!

**Mit Version 1.0.43 haben wir endlich volle Stabilität erreicht:**
- ✅ Keine UnhandledPromiseRejections mehr
- ✅ Keine Session-Errors oder ständige Re-Authentifizierungen
- ✅ Fritz!Box wird nicht mehr überlastet durch zu viele parallele Anfragen
- ✅ Robuste Fehlerbehandlung in allen Komponenten
- ✅ Optimierte Performance durch intelligentes Request-Management

## 📚 Versionshistorie

## 🎆 Was ist neu in Version 1.0.76?

### 📄 Dokumentations-Update
- **NPM-Synchronisation**: Dokumentation mit NPM-Release vereinheitlicht
- **Cleanup**: Unnötige Release-Notes-Dateien entfernt
- **Produktionsstatus**: Version 1.0.76 als aktueller Stable Release markiert
- **Keine Code-Änderungen**: Nur Dokumentation aktualisiert

## 🎆 Was ist neu in Version 1.0.75?

### 📚 FAQ-Bereich für Energiemessung hinzugefügt
- **Neue FAQ**: "Warum sehe ich die Watt-Anzeige nicht in Apple Home?"
- **Klarstellung**: Apple Home zeigt nur Standard-HomeKit-Funktionen
- **Lösung**: Eve App zeigt alle Energiedaten (Watt, kWh, Volt)
- **Dokumentation**: Vollständige Erklärung für FRITZ!DECT 200 Nutzer

## 🎆 Was ist neu in Version 1.0.74?

### 🔌 FRITZ!DECT 200 Leistungsmessung dokumentiert
- **Vollständige Energiedaten**: Leistung (W), Verbrauch (kWh), Spannung (V)
- **Automatische Updates**: Werte werden alle 2 Minuten von der FRITZ!Box aktualisiert
- **HomeKit Integration**: Als Custom Characteristics in der Home App sichtbar
- **API Unterstützung**: getswitchpower, getswitchenergy aus der AHA-HTTP-API

## 🎆 Was ist neu in Version 1.0.73? - FINALE STABLE RELEASE

### 🎆 Produktionsreife Version mit allen Fixes

**Zusammenfassung aller Lösungen:**
- ✅ **Sofortige Reaktion**: Alle Schaltbefehle mit Priority (keine 2-3 Min Wartezeit)
- ✅ **Performance**: 4x schnellere Reaktionszeit (50ms/25ms statt 200ms/100ms)
- ✅ **OFF Mode**: Funktioniert korrekt in HomeKit
- ✅ **Batterieanzeige**: Für alle FRITZ!DECT 301 Thermostate
- ✅ **Keine Fehler**: Keine UnhandledPromiseRejections oder Session-Errors

**Getestete Geräte:**
- 🌡️ FRITZ!DECT 301 Heizkörperregler
- 🔌 FRITZ!DECT 200 Steckdosen mit Leistungsmesser
- 📡 Gäste-WLAN Steuerung

**Technische Details:**
- Thermostat-Commands mit `priority: 10`
- Request-Interval: 50ms, Queue-Delay: 25ms
- OFF Mode aktualisiert nur Heating States
- Batterie-Info aus XML statt API

## 🛠️ Was ist neu in Version 1.0.63?

### 🛠️ Kritische Startup-Fixes
- **Keine falschen Offline-Warnungen**: Beim Start werden Geräte nicht mehr fälschlich als offline erkannt
- **Offline-Status Logging**: Nur noch bei tatsächlichen Statusänderungen
- **getCurrentTemperature**: Keine Offline-Prüfung mehr (verhindert Fehler beim Start)
- **isOffline Flag**: Speichert Offline-Status für bessere Kontrolle

## 🔋 Was ist neu in Version 1.0.62?

### 🔋 Batterie-Warnung Fix
- **Erste Warnung garantiert**: Kritische Batterie wird beim ersten Check gewarnt
- **Logging verbessert**: Debug-Log für normale Batterie (≥80%) beim Start

## 🔧 Was ist neu in Version 1.0.61?

### 🔧 Bugfixes und Verbesserungen
- **StatusFault entfernt**: Nur noch StatusActive (HomeKit-konform)
- **Keine doppelten Batterie-Warnungen**: Intelligentes Logging nur bei Änderungen
- **Bessere Initialisierung**: Keine Fehler mehr beim Start
- **Offline-Status**: Nur StatusActive wird auf false gesetzt

## 🔴 Was ist neu in Version 1.0.60?

### 🔴 Offline-Geräte besser kenntlich
- **StatusFault bei Offline**: Zeigt Fehler-Symbol in HomeKit bei offline Geräten
- **StatusActive Characteristic**: Zeigt aktiv/inaktiv Status in HomeKit
- **Kritische Batterie-Warnung**: Bei ≤5% wird StatusFault gesetzt
- **Temperatur-Fehler bei Offline**: Wirft Fehler wenn offline Gerät abgefragt wird
- **Erweiterte Logs**: Warnt bei offline Geräten und kritischer Batterie

## 🐛 Was ist neu in Version 1.0.59?

### 🐛 BatteryService vollständig gefixt
- **Alle Thermostate zeigen Batterie**: Kompletter Fix für HomeKit Batterieanzeige
- **Initial Values gesetzt**: updateValue() für BatteryLevel und StatusLowBattery
- **Startup Query**: Batterie wird direkt beim Start abgefragt

## 🐛 Was ist neu in Version 1.0.58?

### 🐛 BatteryService Fix für Thermostate
- **Fehlende Batterieanzeige behoben**: Gecachte Thermostate zeigen jetzt Batterie an
- **Automatische Reparatur**: Fehlende BatteryServices werden ergänzt
- **updateAccessoryServices**: Prüft jetzt auch Thermostate
- **Hinweis**: Version 1.0.57 übersprungen wegen NPM Konflikt

## 🐛 Was ist neu in Version 1.0.56?

### 🐛 Thermostat Command-Delay Fix
- **Debouncing entfernt**: Befehle werden sofort ohne Verzögerung ausgeführt
- **HomeKit UI**: Temperatur-Slider springt nicht mehr zurück
- **Command Queue**: Funktioniert jetzt korrekt mit sofortiger Ausführung

## 🔥 Was ist neu in Version 1.0.55?

### 🔥 Critical Thermostat Fixes
- **OFF-Befehl korrigiert**: Verwendet jetzt korrekt "253" statt "off" für FRITZ!DECT Thermostate
- **Temperatur-Limits**: Strikte Einhaltung von 8-28°C Bereich
- **Command Queue**: Rate-Limiting mit 100ms Verzögerung zwischen Befehlen
- **Batterie-Status**: Implementiert via getdeviceinfos XML-API
- **Session Auto-Relogin**: Automatische Neuanmeldung bei 403-Fehlern

## ⚡ Was ist neu in Version 1.0.54?

### ⚡ HomeKit Performance Fix
- **Massiver Performance-Boost**: HomeKit reagiert jetzt sofort auf Befehle
- **Keine UI-Freezes mehr**: Callbacks werden sofort aufgerufen
- **Verbesserte User Experience**: Schalter und Thermostate reagieren ohne Verzögerung

## 🔥 Was ist neu in Version 1.0.53?

### 🔥 Thermostat OFF/ON Fix
- **OFF/ON Modi**: String-Parameter "off"/"on" werden korrekt behandelt
- **Erweiterte Logs**: Zeigen alle Parameter und Fehlerdetails
- **HTTP 500 Fehler**: Bessere Fehlerbehandlung bei ungültigen Befehlen

## 🔋 Was ist neu in Version 1.0.64?

### 🔋 Thermostat Batterie-Fix
- **Batterie-Anzeige repariert**: Alle Thermostate zeigen jetzt Batterie in HomeKit
- **XML-basierte Abfrage**: Batterie-Daten kommen direkt aus XML statt fehlerhafter API-Calls
- **Offline-Geräte**: Zeigen weiterhin gecachte Batterie-Werte an

## 🎯 Was ist neu in Version 1.0.52?

### 🎯 Kritischer Thermostat-Fix
- **Temperatur-Konvertierung repariert**: OFF/ON Modi funktionieren wieder
- **String/Number Handling**: Robuste Behandlung verschiedener Formate
- **NaN-Fehler behoben**: Keine "NaN" Werte mehr bei Temperaturänderungen

## 🔧 Was ist neu in Version 1.0.51?

### 🔧 Thermostat-Bugfix
- **NaN-Fehler behoben**: Temperaturwerte werden korrekt umgewandelt
- **Dezimalwerte unterstützt**: Komma und Punkt als Dezimaltrennzeichen
- **Robuste Konvertierung**: String zu Number mit Fehlerbehandlung

## 🔍 Was ist neu in Version 1.0.50?

### 🔍 Debug-Verbesserungen für Thermostate
- **Erweiterte Debug-Logs**: Zeigt exakte API-Parameter
- **Fehlerdetails**: Bei HTTP 500 Fehlern werden mehr Details geloggt
- **API-Debugging**: Zeigt AIN, Temperatur und umgerechnete Parameter

## 🌡️ Was ist neu in Version 1.0.49?

### 🌡️ Thermostat-Verbesserungen
- **Temperatur-Logging**: Zeigt eingestellte Temperatur im Log
- **Erfolgsmeldungen**: Bestätigung wenn Temperatur gesetzt wurde
- **Bessere Fehlerbehandlung**: Detaillierte Fehlermeldungen

## 🐛 Was ist neu in Version 1.0.48?

### 🐛 Bugfix für Polling-Konfiguration
- **config.interval Fix**: Verwendet korrekt konfigurierten Wert
- **Default-Werte**: Sinnvolle Defaults wenn keine Konfiguration
- **Polling-Intervalle**: Respektiert Benutzer-Einstellungen

## 🚀 Was ist neu in Version 1.0.47?

### 🚀 Performance & Stabilitäts-Update
- **Optimierte Polling-Intervalle**: Angepasst für bessere Performance
- **Reduzierte API-Last**: Weniger häufige Abfragen
- **Batterie-Polling**: Nur noch alle 15 Minuten

## 🔒 Was ist neu in Version 1.0.46?

### 🔒 Sicherheitsupdate
- **Alle Sicherheitslücken behoben**: 0 bekannte Vulnerabilities
- **Dependencies aktualisiert**: Alle Pakete auf neueste Versionen
- **Audit Clean**: npm audit zeigt keine Probleme

[Weitere Versionen siehe CHANGELOG.md]

## 📖 Konfiguration

Die Konfiguration erfolgt über die `config.json` in Homebridge:

```json
{
    "platform": "Fritz!Platform",
    "name": "Fritz!Platform", 
    "username": "IhrFritzBoxBenutzername",
    "password": "IhrFritzBoxPasswort",
    "url": "http://fritz.box",
    "strictSSL": false,
    "interval": 30,
    "concurrent": 1,
    "polling": {
        "init": 30000,
        "discovery": 60000,
        "switchStates": 3000,
        "sensorData": 10000,
        "batteryStatus": 900000
    }
}
```

### Konfigurations-Optionen

| Option | Typ | Standard | Beschreibung |
|--------|-----|----------|--------------|
| `username` | string | *Pflicht* | Fritz!Box Benutzername |
| `password` | string | *Pflicht* | Fritz!Box Passwort |
| `url` | string | `http://fritz.box` | Fritz!Box URL |
| `strictSSL` | boolean | `false` | SSL-Zertifikat prüfen |
| `interval` | number | `30` | Globales Update-Intervall (Sekunden) |
| `concurrent` | number | `1` | Gleichzeitige API-Anfragen |
| `polling` | object | siehe unten | Individuelle Polling-Intervalle |

### Polling-Intervalle (in Millisekunden)

| Option | Standard | Minimum | Beschreibung |
|--------|----------|---------|--------------|
| `init` | 30000 | 1000 | Initiale Wartezeit beim Start |
| `discovery` | 60000 | 1000 | Geräte-Discovery |
| `switchStates` | 3000 | 1000 | Schalter-Status |
| `sensorData` | 10000 | 1000 | Sensor-Daten |
| `batteryStatus` | 900000 | 1000 | Batterie-Status |

## 🔌 Unterstützte Geräte

### ✅ Vollständig unterstützt

- **FRITZ!DECT 200/210**: Schaltbare Steckdose mit Energiemessung
- **FRITZ!DECT 300/301/302**: Heizkörperthermostate
- **FRITZ!DECT 500**: LED-Lampe (Farbe, Helligkeit, Temperatur)
- **FRITZ!DECT 100**: Temperatursensor
- **FRITZ!DECT 140**: Tür-/Fensterkontakt
- **FRITZ!DECT 400**: Universaltaster
- **FRITZ!DECT 440**: 4-Taster mit Display und Temperatursensor
- **FRITZ!Powerline 546E**: Schaltbare Steckdose
- **Comet DECT**: Heizkörperthermostat
- **Magenta SmartHome**: Kompatible Geräte
- **Rademacher RolloTron**: Rollladensteuerung
- **ELRO Connects**: Kompatible Geräte

### 🚧 Experimentell

- **FRITZ!DECT 350**: Tür-/Fensterkontakt (neu)
- **FRITZ!DECT 600**: LED-Lampe (neu)

### 🔧 Spezial-Features

- **Gäste-WLAN**: Ein-/Ausschalten des Gäste-WLANs
- **WAN-IP**: Anzeige der externen IP-Adresse
- **Anrufbeantworter**: Status-Anzeige

## 🛠️ Erweiterte Konfiguration

### Mehrere Fritz!Boxen

Sie können mehrere Fritz!Box Geräte einbinden:

```json
{
    "platforms": [
        {
            "platform": "Fritz!Platform",
            "name": "Haupthaus",
            "username": "admin1",
            "password": "password1",
            "url": "http://192.168.1.1"
        },
        {
            "platform": "Fritz!Platform", 
            "name": "Gästehaus",
            "username": "admin2",
            "password": "password2",
            "url": "http://192.168.2.1"
        }
    ]
}
```

### Filter für Geräte

Sie können Geräte nach Namen filtern:

```json
{
    "platform": "Fritz!Platform",
    "username": "admin",
    "password": "password",
    "filter": {
        "include": ["Wohnzimmer", "Küche"],
        "exclude": ["Test", "Debug"]
    }
}
```

## 🔍 Fehlerbehebung

### Häufige Probleme

**1. "Wrong user credentials" Fehler**
- Prüfen Sie Benutzername und Passwort
- Stellen Sie sicher, dass der Benutzer Smart-Home-Rechte hat
- Prüfen Sie ob die Fritz!Box erreichbar ist

**2. Geräte werden nicht gefunden**
- Smart Home muss in der Fritz!Box aktiviert sein
- Geräte müssen in der Fritz!Box angemeldet sein
- Führen Sie einen Neustart von Homebridge durch

**3. Thermostat zeigt falsche Temperatur**
- Prüfen Sie die Kalibrierung in der Fritz!Box
- Stellen Sie sicher, dass das Gerät online ist

### Debug-Modus

Für erweiterte Fehlersuche:

```json
{
    "platform": "Fritz!Platform",
    "username": "admin",
    "password": "password",
    "debug": true
}
```

## 🤝 Beitragen

Beiträge sind willkommen! Bitte beachten Sie:

1. Fork das Repository
2. Feature Branch erstellen (`git checkout -b feature/AmazingFeature`)
3. Änderungen committen (`git commit -m 'Add some AmazingFeature'`)
4. Branch pushen (`git push origin feature/AmazingFeature`)
5. Pull Request öffnen

### Code-Standards
- ESLint-Regeln befolgen
- Tests für neue Features schreiben
- Dokumentation aktualisieren
- Semantic Versioning beachten

### Tests ausführen
```bash
npm test
npm run lint
npm run coverage
```

## ❓ FAQ - Häufig gestellte Fragen

### Warum sehe ich die Watt-Anzeige nicht in Apple Home?

Apple's Home App zeigt bewusst nur Standard-HomeKit-Funktionen. Für FRITZ!DECT 200 Steckdosen bedeutet das:

**In Apple Home sichtbar:**
- ✅ Ein/Aus-Schalter
- ✅ Status (an/aus)

**Nur in Eve App (oder ähnlichen) sichtbar:**
- ⚡ Aktuelle Leistung in Watt
- 📈 Energieverbrauch in kWh
- 🔋 Spannung in Volt
- 📊 Verlaufsgraphen

**Empfehlung**: Installieren Sie die kostenlose [Eve App](https://apps.apple.com/app/eve-for-homekit/id917695792) für vollständige Energiedaten. Die Eve App zeigt ALLE Daten, auch Custom Characteristics wie Leistungsmessung.

### Warum dauerte die Temperaturänderung früher so lange?

Bis Version 1.0.69 mussten Thermostat-Befehle in einer Queue warten. Seit v1.0.70 haben alle Schaltbefehle Priority und werden sofort ausgeführt.

## 📄 Lizenz

Dieses Projekt ist unter der MIT-Lizenz lizenziert - siehe [LICENSE](LICENSE) Datei für Details.

## 🙏 Credits

### Original-Autor
- Andreas Goetz ([@andig](https://github.com/andig)) - Ursprünglicher Entwickler von homebridge-fritz

### Fork-Maintainer
- glowf1sh ([@glowf1sh](https://github.com/glowf1sh)) - Aktueller Maintainer von homebridge-fritz-new

### Contributors
- Alle [Contributors](https://github.com/glowf1sh/homebridge-fritz-new/graphs/contributors) die zu diesem Fork beigetragen haben

### Besonderer Dank
- Homebridge Community für das großartige Framework
- AVM für die FRITZ!Box APIs
- Alle Nutzer die Bugs melden und Features vorschlagen

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/glowf1sh/homebridge-fritz-new/issues)
- **Discussions**: [GitHub Discussions](https://github.com/glowf1sh/homebridge-fritz-new/discussions)
- **NPM**: [npmjs.com/package/homebridge-fritz-new](https://www.npmjs.com/package/homebridge-fritz-new)

## 🔗 Links

- [Homebridge](https://homebridge.io)
- [FRITZ!Box](https://avm.de/produkte/fritzbox/)
- [Original homebridge-fritz](https://github.com/andig/homebridge-fritz) (veraltet)
- [NPM Package](https://www.npmjs.com/package/homebridge-fritz-new)

---

**Hinweis**: Dies ist ein Community-Fork und steht in keiner Verbindung zu AVM GmbH.

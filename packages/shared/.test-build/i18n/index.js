"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.te = exports.hi = exports.en = exports.dictionaries = exports.LOCALE_LABELS = exports.DEFAULT_LOCALE = exports.LOCALES = void 0;
exports.getDictionary = getDictionary;
exports.isLocale = isLocale;
exports.pickI18n = pickI18n;
const en_1 = require("./en");
Object.defineProperty(exports, "en", { enumerable: true, get: function () { return en_1.en; } });
const hi_1 = require("./hi");
Object.defineProperty(exports, "hi", { enumerable: true, get: function () { return hi_1.hi; } });
const te_1 = require("./te");
Object.defineProperty(exports, "te", { enumerable: true, get: function () { return te_1.te; } });
exports.LOCALES = ['en', 'hi', 'te'];
exports.DEFAULT_LOCALE = 'en';
exports.LOCALE_LABELS = {
    en: 'English',
    hi: 'हिन्दी',
    te: 'తెలుగు',
};
exports.dictionaries = { en: en_1.en, hi: hi_1.hi, te: te_1.te };
function getDictionary(locale) {
    if (locale && exports.LOCALES.includes(locale)) {
        return exports.dictionaries[locale];
    }
    return exports.dictionaries[exports.DEFAULT_LOCALE];
}
function isLocale(value) {
    return exports.LOCALES.includes(value);
}
/**
 * Pick a localised value out of a `*I18n` JSONB column, falling back to the base
 * column. Menu items get Hindi/Telugu names as data, not as code.
 */
function pickI18n(base, i18n, locale) {
    const v = i18n?.[locale];
    return v && v.trim() ? v : base;
}

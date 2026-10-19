import { DwUtility } from "./utility.js";

export class DwRegisterHelpers {
  static init() {
    Handlebars.registerHelper('concat', function() {
      var outStr = '';
      for (var arg in arguments) {
        if (typeof arguments[arg] != 'object') {
          outStr += arguments[arg];
        }
      }
      return outStr;
    });

    Handlebars.registerHelper('dwTags', function(tagsInput) {
      const tags = DwUtility.parseTags(tagsInput).map(tag => `<div class="tag">${DwUtility.escape(tag)}</div>`);
      return `<div class="tags">${tags.join('')}</div>`;
    });

    Handlebars.registerHelper('ifEquals', function(arg1, arg2, options) {
      return (arg1 == arg2) ? options.fn(this) : options.inverse(this);
    });

    Handlebars.registerHelper('ifor', function(arg1, arg2, options) {
      return (arg1 || arg2) ? options.fn(this) : options.inverse(this);
    });

    Handlebars.registerHelper('progressCircle', function(data) {
      return `<svg class="progress-ring progress-ring--${data.class}" viewBox="0 0 ${data.diameter} ${data.diameter}" width="${data.diameter}" height="${data.diameter}">
      <circle
        class="progress-ring__circle"
        stroke-width="${data.strokeWidth}"
        stroke-dasharray="${data.circumference}"
        stroke-dashoffset="${data.offset}"
        stroke="${data.color}"
        fill="transparent"
        r="${data.radius}"
        cx="${data.position}"
        cy="${data.position}"
      />
    </svg>`;
    });

    Handlebars.registerHelper('localizeOverride', function(i18nKey, settingKey = false) {
      const result = settingKey ? game.settings.get('dungeonworld', settingKey) : '';
      if (typeof result === 'string' && result.length > 0) return result;
      return game.i18n.localize(i18nKey) ?? '';
    });
  }
}
export const RUSSIA_REGION_CODES = {
  Adygey: ['Республика Адыгея', 'Адыгея'],
  Altay: ['Алтайский край'],
  Amur: ['Амурская область'],
  "Arkhangel'sk": ['Архангельская область'],
  "Astrakhan'": ['Астраханская область'],
  Bashkortostan: ['Республика Башкортостан', 'Башкортостан'],
  Belgorod: ['Белгородская область'],
  Bryansk: ['Брянская область'],
  Buryat: ['Республика Бурятия', 'Бурятия'],
  Chechnya: ['Чеченская Республика', 'Чечня'],
  Chelyabinsk: ['Челябинская область'],
  Chukot: ['Чукотский автономный округ', 'Чукотский АО'],
  Chuvash: ['Чувашская Республика', 'Чувашия'],
  Dagestan: ['Республика Дагестан', 'Дагестан'],
  'Gorno-Altay': ['Республика Алтай'],
  Ingush: ['Республика Ингушетия', 'Ингушетия'],
  Irkutsk: ['Иркутская область'],
  Ivanovo: ['Ивановская область'],
  'Kabardin-Balkar': ['Кабардино-Балкарская Республика', 'Кабардино-Балкария'],
  'Karachay-Cherkess': ['Карачаево-Черкесская Республика', 'Карачаево-Черкесия'],
  Krasnodar: ['Краснодарский край'],
  Kemerovo: ['Кемеровская область', 'Кемеровская область — Кузбасс', 'Кузбасс'],
  Kaluga: ['Калужская область'],
  Khabarovsk: ['Хабаровский край'],
  Karelia: ['Республика Карелия', 'Карелия'],
  Khakass: ['Республика Хакасия', 'Хакасия'],
  Kalmyk: ['Республика Калмыкия', 'Калмыкия'],
  'Khanty-Mansiy': ['Ханты-Мансийский автономный округ', 'Ханты-Мансийский автономный округ — Югра', 'ХМАО', 'ХМАО — Югра'],
  Kaliningrad: ['Калининградская область'],
  Komi: ['Республика Коми', 'Коми'],
  Kamchatka: ['Камчатский край'],
  Kursk: ['Курская область'],
  Kostroma: ['Костромская область'],
  Kurgan: ['Курганская область'],
  Kirov: ['Кировская область'],
  Krasnoyarsk: ['Красноярский край'],
  Leningrad: ['Ленинградская область'],
  Lipetsk: ['Липецкая область'],
  'Moscow City': ['Москва', 'г. Москва', 'город Москва'],
  'Mariy-El': ['Республика Марий Эл', 'Марий Эл'],
  Magadan: ['Магаданская область'],
  Murmansk: ['Мурманская область'],
  Mordovia: ['Республика Мордовия', 'Мордовия'],
  Moskva: ['Московская область'],
  Novgorod: ['Новгородская область'],
  Nenets: ['Ненецкий автономный округ', 'Ненецкий АО'],
  'North Ossetia': ['Республика Северная Осетия — Алания', 'Северная Осетия — Алания', 'Северная Осетия'],
  Novosibirsk: ['Новосибирская область'],
  Nizhegorod: ['Нижегородская область'],
  Orenburg: ['Оренбургская область'],
  Orel: ['Орловская область'],
  Omsk: ['Омская область'],
  "Perm'": ['Пермский край'],
  "Primor'ye": ['Приморский край'],
  Pskov: ['Псковская область'],
  Penza: ['Пензенская область'],
  Rostov: ['Ростовская область'],
  "Ryazan'": ['Рязанская область'],
  Samara: ['Самарская область'],
  Sakha: ['Республика Саха (Якутия)', 'Республика Саха', 'Якутия'],
  Sakhalin: ['Сахалинская область'],
  Smolensk: ['Смоленская область'],
  'Saint Petersburg City': ['Санкт-Петербург', 'г. Санкт-Петербург', 'город Санкт-Петербург'],
  Saratov: ['Саратовская область'],
  "Stavropol'": ['Ставропольский край'],
  Sverdlovsk: ['Свердловская область'],
  Tambov: ['Тамбовская область'],
  Tomsk: ['Томская область'],
  Tula: ['Тульская область'],
  Tatarstan: ['Республика Татарстан', 'Татарстан'],
  Tuva: ['Республика Тыва', 'Тыва', 'Тува'],
  "Tver'": ['Тверская область'],
  "Tyumen'": ['Тюменская область'],
  Udmurt: ['Удмуртская Республика', 'Удмуртия'],
  "Ul'yanovsk": ['Ульяновская область'],
  Volgograd: ['Волгоградская область'],
  Vladimir: ['Владимирская область'],
  'Yamal-Nenets': ['Ямало-Ненецкий автономный округ', 'Ямало-Ненецкий АО', 'ЯНАО'],
  Vologda: ['Вологодская область'],
  Voronezh: ['Воронежская область'],
  "Yaroslavl'": ['Ярославская область'],
  Yevrey: ['Еврейская автономная область', 'Еврейская АО'],
  "Zabaykal'ye": ['Забайкальский край'],
} as const;

export type RussiaRegionCode = keyof typeof RUSSIA_REGION_CODES;
export const RUSSIA_REGION_CODE_LIST = Object.keys(RUSSIA_REGION_CODES) as RussiaRegionCode[];

function normalizeRegionName(value: string) {
  return value
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[–—]/g, '-')
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const codeByAlias = new Map<string, RussiaRegionCode>();
const primaryNameByCode = new Map<RussiaRegionCode, string>();

Object.entries(RUSSIA_REGION_CODES).forEach(([code, aliases]) => {
  const typedCode = code as RussiaRegionCode;
  primaryNameByCode.set(typedCode, aliases[0]);
  aliases.forEach(alias => codeByAlias.set(normalizeRegionName(alias), typedCode));
});

export function getRussiaRegionCode(areaName: string) {
  return codeByAlias.get(normalizeRegionName(areaName)) || null;
}

export function getRussiaRegionName(code: string) {
  return primaryNameByCode.get(code as RussiaRegionCode) || code;
}

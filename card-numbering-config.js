export const groupDistricts = { '024': '02', '025': '02', '026': '01', '027': '02' };
export const districtForGroup = groupCode => groupDistricts[String(Number(groupCode)).padStart(Number(groupCode) < 20 ? 2 : 3, '0')];

export const cardCatalog = {
  regions: [['00', '** / Unspecified'], ['01', 'بيروت / Beirut'], ['02', 'جبل لبنان / Mount Lebanon'], ['03', 'الشمال / North'], ['04', 'الجنوب / South'], ['05', 'البقاع / Bekaa']],
  roles: [['1', 'سلك القيادة / Leadership'], ['2', 'أفراد / Member']],
  groups: Array.from({ length: 101 }, (_, value) => {
    const code = String(value).padStart(value < 20 ? 2 : 3, '0');
    const name = { 0: 'Unspecified', 1: 'جمعية عمومية / General Assembly', 2: 'القيادة العامة / General Leadership', 3: 'المفوضية العامة / General Commissariat', 24: 'NDA', 25: 'NDMC', 26: 'NDP', 27: 'NDAK' }[value];
    return [code, name || (value < 20 ? `Non-group ${code}` : `Group ${code}`)];
  }),
};

export const formatCardParts = ({ regionCode, groupCode, roleCode, cardSerial }) =>
  `${String(regionCode).padStart(2, '0')}${String(Number(groupCode)).padStart(Number(groupCode) < 20 ? 2 : 3, '0')}${roleCode}${String(cardSerial).padStart(4, '0')}`;

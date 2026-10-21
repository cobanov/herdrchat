// The Android tab bar was Material 3's 80dp and read as far too thick on a phone.
const { dimensXml } = jest.requireActual('../../../plugins/withCompactTabBar') as { dimensXml: () => string };

it('overrides the Material 3 bottom bar to 64dp', () => {
  const xml = dimensXml();
  expect(xml).toContain('<dimen name="m3_bottom_nav_min_height" tools:override="true">64dp</dimen>');
  expect(xml).toContain('m3_bottom_nav_item_padding_top');
  expect(xml).toContain('m3_bottom_nav_item_padding_bottom');
  expect(xml).toContain('xmlns:tools=');
});

// 宿主传入的配置：只包含环境相关的东西
export interface TagloomConfig {
  // 本插件的数据目录（按项目约定为 <根目录>/data/tagloom）；人物 JSON 存在 <dataDir>/characters/，场景在 <dataDir>/scenes/
  dataDir: string
  // 标签词库（只读），默认 <dataDir>/tag_catalog.sqlite；文件不存在时插件照常可用，只是不做数据库核查
  catalogPath?: string
  // 词库导入界面能选的数据源目录（只能选它里面的目录），默认 <dataDir>/../data_source
  sourceDir?: string
  // 是否显示受限标签（词库 restricted=1），默认不显示
  allowRestricted?: boolean
}

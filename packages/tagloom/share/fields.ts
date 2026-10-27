// 分类树与选词字段（依据 TagLoom 需求文档中的分类与输出规则，以及字段—词库分类映射表）。
// 「分类」（segment）是有一段最终 Prompt 的编辑单元；「选词字段」（field）只是分类内的候选来源，不单独输出。
// 顺序即界面顺序与默认拼接顺序，不是权重规则。

// 候选来源方式：类别参考 / 跨类精选 / 文本优先 / 仅资料
export type FieldStrategy =
  | 'category_filtered'
  | 'cross_category_curated'
  | 'text_first'
  | 'metadata_only'

export interface FieldDef {
  key: string
  label: string
  // 头发下的小类别：发色 / 发型；其他分类不分组
  group?: 'hair_color' | 'hair_style'
  // 可选字段默认折叠在「更多选词」里
  optional: boolean
  strategy: FieldStrategy
  // 词库分类路径（含后代）；空数组表示没有对应分类，只能自由输入或全库检索
  categoryPaths: string[]
  // 已核查的示例标签（只作提示，不是选项清单）
  examples: string[]
  note: string
}

export interface SegmentDef<K extends string = string> {
  key: K
  label: string
  fields: FieldDef[]
  // 「其他」与「更多服装分类」默认折叠
  collapsed?: boolean
}

const f = (
  key: string,
  label: string,
  optional: boolean,
  strategy: FieldStrategy,
  categoryPaths: string,
  examples: string,
  note: string,
  group?: FieldDef['group'],
): FieldDef => ({
  key,
  label,
  optional,
  strategy,
  categoryPaths: categoryPaths ? categoryPaths.split('|') : [],
  examples: examples ? examples.split('|') : [],
  note,
  ...(group ? { group } : {}),
})

// ── Base：头发 → 眼睛 → 身形 → 其他 ──────────────────────────────

export const HAIR_FIELDS: FieldDef[] = [
  f(
    'hair_color',
    '发色',
    false,
    'category_filtered',
    'character.body.hair.color',
    'blue hair',
    '与染色结构分维度',
    'hair_color',
  ),
  f(
    'hair_color_pattern',
    '染色结构',
    true,
    'category_filtered',
    'character.body.hair.color',
    '',
    '挑染、渐变、双色等；不与基本色重复堆叠',
    'hair_color',
  ),
  f(
    'hair_length',
    '头发长度',
    false,
    'category_filtered',
    'character.body.hair.length',
    'long hair',
    '资料分项不强制 Prompt 拆分',
    'hair_style',
  ),
  f(
    'hair_style',
    '整体发型',
    false,
    'cross_category_curated',
    'character.body.hair.cut|character.body.hair.ponytail|character.body.hair.twintail|character.body.hair.braid|character.body.hair.bun|character.body.hair.tied_misc',
    'hair bun',
    '剪裁与扎发结构合并为一个入口；筛掉状态',
    'hair_style',
  ),
  f(
    'hair_texture',
    '质感与卷直',
    false,
    'category_filtered',
    'character.body.hair.texture',
    'straight hair',
    '只固化已确认结构',
    'hair_style',
  ),
  f(
    'front_hair_presence',
    '有无刘海',
    true,
    'text_first',
    'character.body.hair.bangs',
    '',
    '无刘海是明确事实；未选不等于无',
    'hair_style',
  ),
  f(
    'bangs_shape',
    '刘海形状',
    true,
    'category_filtered',
    'character.body.hair.bangs',
    'blunt bangs',
    '与刘海长度及分缝分开',
    'hair_style',
  ),
  f(
    'bangs_length',
    '刘海长度',
    true,
    'category_filtered',
    'character.body.hair.bangs',
    '',
    '不把该分类全部标签作为长度选项',
    'hair_style',
  ),
  f(
    'hair_parting',
    '分缝',
    true,
    'cross_category_curated',
    'character.body.hair.tied_misc',
    'middle part|side part',
    '只精选分缝语义',
    'hair_style',
  ),
  f(
    'sidelock',
    '侧发与鬓发',
    true,
    'category_filtered',
    'character.body.hair.sidelock',
    'sidelocks',
    '',
    'hair_style',
  ),
  f(
    'hair_face_relation',
    '头发与面部遮挡',
    true,
    'text_first',
    'character.body.hair.position',
    '',
    '只记录固定设计；风吹遮眼等是临时状态',
    'hair_style',
  ),
  f(
    'hair_extra_structure',
    '呆毛及其他结构',
    true,
    'cross_category_curated',
    'character.body.hair.ahoge|character.body.hair.drill|character.body.hair.special',
    'ahoge',
    '筛选固定结构；不自动补造',
    'hair_style',
  ),
]

const EYE_FIELDS: FieldDef[] = [
  f(
    'eye_color',
    '眼色',
    false,
    'category_filtered',
    'character.body.eye.color',
    'blue eyes',
    '异色归入左右眼差异',
  ),
  f(
    'eye_shape',
    '眼型',
    true,
    'category_filtered',
    'character.body.eye.shape',
    'tsurime|tareme',
    '近义中文译名不代表同一眼型',
  ),
  f(
    'eye_asymmetry',
    '左右眼差异',
    true,
    'cross_category_curated',
    'character.body.eye.color|character.body.eye.special',
    'heterochromia',
    '具体左右颜色保留独立归属',
  ),
  f(
    'eye_detail',
    '瞳孔与其他固定眼特征',
    true,
    'cross_category_curated',
    'character.body.eye.pupil|character.body.eye.sclera|character.body.eye.special',
    '',
    '闭眼、含泪等当前表现不固化',
  ),
]

const BODY_FIELDS: FieldDef[] = [
  f(
    'breast_size',
    '胸部尺寸',
    false,
    'category_filtered',
    'character.body.breast',
    'flat chest|small breasts|medium breasts|large breasts',
    '仅精选尺寸；未填不默认某尺寸',
  ),
  f(
    'body_build',
    '整体胖瘦与体量',
    false,
    'category_filtered',
    'character.body.physique.build',
    'skinny|plump|fat',
    '与肌肉、曲线分轴；「纤细」不强制译成 skinny',
  ),
  f(
    'body_muscle',
    '肌肉程度',
    false,
    'category_filtered',
    'character.body.physique.build',
    'toned|muscular',
    '不与胖瘦做成同一互斥列表',
  ),
  f(
    'body_curve',
    '曲线与轮廓',
    true,
    'category_filtered',
    'character.body.physique.build',
    'curvy|pear-shaped figure',
    'curvy 不替代胸部尺寸',
  ),
  f(
    'waist_hip',
    '腰胯比例',
    true,
    'category_filtered',
    'character.body.physique.proportion',
    'narrow waist|wide hips|narrow hips',
    '腰宽胯宽分别记录',
  ),
  f(
    'height_note',
    '精确身高资料',
    true,
    'metadata_only',
    '',
    '',
    '仅资料，不自动转换成高矮标签',
  ),
  f(
    'body_proportion',
    '身高与体量印象',
    true,
    'cross_category_curated',
    'character.body.physique.proportion|character.body.physique.build',
    'tall|petite',
    'petite 不等于偏瘦或某年龄',
  ),
  f(
    'leg_proportion',
    '腿部比例与体量',
    true,
    'cross_category_curated',
    'character.body.body_part.leg|character.body.body_part.thigh',
    'long legs|thick thighs',
    '腿长与体量分维度',
  ),
  f(
    'shoulder_proportion',
    '肩部比例',
    true,
    'category_filtered',
    'character.body.physique.proportion',
    'broad shoulders',
    '',
  ),
  f(
    'body_detail',
    '局部体征',
    true,
    'text_first',
    'character.body.body_part',
    'abs',
    '按需添加',
  ),
]

const OTHER_FIELDS: FieldDef[] = [
  f(
    'face_description',
    '脸型与面部描述',
    true,
    'text_first',
    'character.body.face.head_shape|character.body.face.morphology',
    '',
    '未收录时保留自然语言',
  ),
  f(
    'eyebrow_eyelash',
    '眉毛与睫毛',
    true,
    'cross_category_curated',
    'character.body.face.eyebrow|character.body.eye.eyelash',
    '',
    '',
  ),
  f(
    'face_detail',
    '鼻唇牙齿及面部毛发',
    true,
    'text_first',
    'character.body.face.nose|character.body.face.lips_mouth|character.body.face.teeth|character.body.face.fang|character.body.face.facial_hair',
    '',
    '',
  ),
  f(
    'skin_color',
    '肤色',
    true,
    'category_filtered',
    'character.skin.color',
    '',
    '已确认颜色不因折叠被删掉',
  ),
  f(
    'skin_texture',
    '长期肤质',
    true,
    'category_filtered',
    'character.skin.texture_condition',
    '',
    '筛掉临时损伤、污渍状态',
  ),
  f(
    'recognition_mark',
    '识别标记',
    true,
    'cross_category_curated',
    'character.body.face.mole_freckle|character.skin.body_mole_freckle|character.body.face.scar_injury|character.skin.scar_wound|character.skin.tattoo',
    'mole|freckles|scar|tattoo',
    '记录部位、左右、数量；永久与临时区分',
  ),
  f(
    'fixed_makeup',
    '长期妆容',
    true,
    'text_first',
    'character.body.face.makeup|character.body.face.lips_mouth',
    'lipstick',
    '随造型变化的妆容放到对应组合',
  ),
  f(
    'fixed_accessory',
    '固定配饰',
    true,
    'cross_category_curated',
    'apparel.worn_accessory.eyewear|apparel.worn_accessory.hair_ornament|apparel.worn_accessory.jewelry|apparel.worn_accessory.wearable',
    'glasses|hairclip',
    '是否固定由用户决定，不由数据库决定',
  ),
  f(
    'ear_feature',
    '耳部特征',
    true,
    'cross_category_curated',
    'character.body.face.ear|character.body.ear',
    'pointy ears',
    '',
  ),
  f(
    'horn_feature',
    '角',
    true,
    'category_filtered',
    'character.body.horn',
    'horns',
    '',
  ),
  f(
    'tail_feature',
    '尾',
    true,
    'category_filtered',
    'character.body.tail',
    'tail',
    '不由种族标签自动补造',
  ),
  f(
    'wing_feature',
    '翼',
    true,
    'category_filtered',
    'character.body.wing',
    'wings',
    '',
  ),
  f(
    'other_body_feature',
    '其他非人特征',
    true,
    'text_first',
    'character.nonhuman_trait',
    '',
    '',
  ),
]

export const BASE_SEGMENT_KEYS = ['hair', 'eyes', 'body', 'other'] as const
export type BaseSegmentKey = typeof BASE_SEGMENT_KEYS[number]

export const BASE_SEGMENTS: SegmentDef<BaseSegmentKey>[] = [
  { key: 'hair', label: '头发', fields: HAIR_FIELDS },
  { key: 'eyes', label: '眼睛', fields: EYE_FIELDS },
  { key: 'body', label: '身形', fields: BODY_FIELDS },
  {
    key: 'other',
    label: '其他固定特征',
    fields: OTHER_FIELDS,
    collapsed: true,
  },
]

// ── 造型组合：整体服装补充 + 固定分类 + 更多服装分类；发型覆盖单独处理 ──

// 颜色、材质、领型等在对应衣物分类内辅助选词，不另设一级分类
const PART_FIELDS: FieldDef[] = [
  f(
    'part_color',
    '部件颜色',
    true,
    'text_first',
    '',
    '',
    '颜色绑定当前衣物；不要求独立颜色 tag',
  ),
  f(
    'part_length_shape',
    '长度与轮廓',
    true,
    'text_first',
    'apparel.garment.dress.dress_cut|apparel.state.clothing_fit',
    '',
    '',
  ),
  f(
    'part_neckline',
    '领型与领口',
    true,
    'category_filtered',
    'apparel.detail.collar_neckline',
    '',
    '',
  ),
  f(
    'part_sleeve',
    '袖型',
    true,
    'cross_category_curated',
    'apparel.detail.sleeve|apparel.garment.top.shirt',
    'short sleeves|sleeveless shirt',
    '存在结构组合标签，避免重复单品表达',
  ),
  f(
    'part_construction',
    '其他结构',
    true,
    'cross_category_curated',
    'apparel.detail.garment_construction|apparel.detail.opening_strap|apparel.detail.fastener|apparel.detail.pocket',
    '',
    '',
  ),
  f(
    'part_material',
    '材质',
    true,
    'cross_category_curated',
    'object.material|apparel.detail.material_layer|apparel.detail.pattern.general',
    'silk|satin|leather|latex|denim',
    '不混入图案和临时状态',
  ),
  f(
    'part_pattern',
    '图案',
    true,
    'category_filtered',
    'apparel.detail.pattern',
    '',
    '',
  ),
  f(
    'part_trim',
    '花边与装饰',
    true,
    'cross_category_curated',
    'apparel.detail.trim_frill|apparel.detail.bow_ribbon_lace|apparel.detail.emblem_marking',
    'lace trim',
    '',
  ),
  f(
    'part_placement',
    '左右位置与数量',
    true,
    'text_first',
    '',
    '',
    '自然语言关系优先',
  ),
  f(
    'part_layer',
    '实际穿着层次',
    true,
    'text_first',
    'apparel.state.layering_order',
    '',
    '单品类型与穿着层次分开；分类不决定层次',
  ),
]

const garment = (
  key: string,
  label: string,
  categoryPaths: string,
  examples: string,
  note: string,
  extra: FieldDef[] = [],
): FieldDef[] => [
  f(key, label, false, 'category_filtered', categoryPaths, examples, note),
  ...extra,
  ...PART_FIELDS,
]

export const COMBO_SEGMENT_KEYS = [
  'overall',
  'top',
  'bottom',
  'outer',
  'legwear',
  'footwear',
  'accessory',
  'onepiece',
  'underwear_upper',
  'underwear_lower',
  'underwear_other',
] as const
export type ComboSegmentKey = typeof COMBO_SEGMENT_KEYS[number]

export const COMBO_SEGMENTS: SegmentDef<ComboSegmentKey>[] = [
  {
    key: 'overall',
    label: '整体服装补充',
    fields: [
      f(
        'overall_clothing_prompt',
        '原型与整体样式',
        false,
        'text_first',
        'apparel.garment.uniform|apparel.garment.traditional|apparel.garment.swimwear|apparel.garment.dress.costume|apparel.garment.dress.suit',
        '',
        '原串不自动拆分；不要求套装名称',
      ),
    ],
  },
  {
    key: 'top',
    label: '上装',
    fields: garment(
      'top',
      '上装单品',
      'apparel.garment.top',
      'shirt|camisole',
      '',
    ),
  },
  {
    key: 'bottom',
    label: '下装',
    fields: garment(
      'bottom',
      '下装单品',
      'apparel.garment.bottom',
      'skirt',
      '叠穿用提示词表达',
    ),
  },
  {
    key: 'outer',
    label: '外套',
    fields: garment(
      'outer_piece',
      '外套单品',
      'apparel.garment.outerwear|apparel.garment.top.cardigan',
      'cardigan',
      '不自动决定层次',
    ),
  },
  {
    key: 'legwear',
    label: '腿装',
    fields: garment(
      'legwear',
      '腿装单品',
      'apparel.legwear',
      '',
      '分清袜、裤袜、连体袜',
    ),
  },
  {
    key: 'footwear',
    label: '鞋',
    fields: garment(
      'footwear',
      '鞋',
      'apparel.footwear',
      '',
      '未填不等于明确不穿',
    ),
  },
  {
    key: 'accessory',
    label: '配饰',
    fields: garment(
      'accessory',
      '配饰单品',
      'apparel.worn_accessory',
      '',
      '固定辨识物在 Base「其他」里定义',
      [
        f(
          'handwear',
          '手套与臂套',
          true,
          'category_filtered',
          'apparel.garment.handwear',
          '',
          '首版归配饰',
        ),
        f(
          'headwear',
          '头饰',
          true,
          'category_filtered',
          'apparel.headwear',
          '',
          '首版归配饰；筛掉状态',
        ),
      ],
    ),
  },
  {
    key: 'onepiece',
    label: '整件／连体服装',
    collapsed: true,
    fields: garment(
      'onepiece',
      '整件单品',
      'apparel.garment.dress|apparel.garment.swimwear.one_piece',
      'dress|leotard',
      '不自动清空上下装',
    ),
  },
  {
    key: 'underwear_upper',
    label: '内衣上身',
    collapsed: true,
    fields: garment(
      'underwear_upper',
      '内衣上身单品',
      'apparel.garment.underwear.bra|apparel.garment.top.sports_bra',
      'bra|sports bra',
      '实际层次需确认',
    ),
  },
  {
    key: 'underwear_lower',
    label: '内衣下身',
    collapsed: true,
    fields: garment(
      'underwear_lower',
      '内衣下身单品',
      'apparel.garment.underwear.panties|apparel.garment.underwear.male',
      'panties',
      '',
    ),
  },
  {
    key: 'underwear_other',
    label: '其他贴身层／内衣配件',
    collapsed: true,
    fields: garment(
      'underwear_other',
      '贴身层与配件',
      'apparel.garment.underwear|apparel.legwear.accessories',
      'garter belt|garter straps',
      '腰带与连接带分清',
    ),
  },
]

// 发型覆盖：低频可选，放在组合最下面；字段与 Base 头发相同
export const HAIR_OVERRIDE_SEGMENT: SegmentDef<'hair_override'> = {
  key: 'hair_override',
  label: '发型覆盖',
  fields: HAIR_FIELDS,
  collapsed: true,
}

// ── 角色状态：神态与表情、动作与姿势 ──────────────────────────────

export const EXPRESSION_FIELDS: FieldDef[] = [
  f(
    'expression',
    '神态与表情',
    false,
    'text_first',
    '',
    '',
    '面部表情、眼神与神态',
  ),
]

export const EXPRESSION_SEGMENT: SegmentDef<'expression'> = {
  key: 'expression',
  label: '神态与表情',
  fields: EXPRESSION_FIELDS,
}

export const ACTION_FIELDS: FieldDef[] = [
  f(
    'action',
    '动作与姿势',
    false,
    'text_first',
    '',
    '',
    '身体姿态、手势与动作',
  ),
]

export const ACTION_SEGMENT: SegmentDef<'action'> = {
  key: 'action',
  label: '动作与姿势',
  fields: ACTION_FIELDS,
}

// ── 状态覆盖作用域目标 ──────────────────────────────────────────

export const BASE_OVERRIDE_TARGETS = BASE_SEGMENT_KEYS.map(
  (k) => `base.${k}` as const,
)
export type BaseOverrideTarget = `base.${BaseSegmentKey}`

export const COSTUME_OVERRIDE_TARGETS = COMBO_SEGMENT_KEYS.map(
  (k) => `costume.${k}` as const,
)
export type CostumeOverrideTarget = `costume.${ComboSegmentKey}`

export const STATE_OVERRIDE_TARGETS = [
  ...BASE_OVERRIDE_TARGETS,
  ...COSTUME_OVERRIDE_TARGETS,
] as const
export type StateOverrideTarget = BaseOverrideTarget | CostumeOverrideTarget

export function overrideTargetLabel(target: string): string {
  if (target === 'base.hair') return '发型'
  if (target.startsWith('base.')) {
    const k = target.slice(5)
    return BASE_SEGMENTS.find((s) => s.key === k)?.label ?? k
  }
  if (target.startsWith('costume.')) {
    const k = target.slice(8)
    return COMBO_SEGMENTS.find((s) => s.key === k)?.label ?? k
  }
  return target
}

export function overrideSegmentDef(target: StateOverrideTarget): SegmentDef {
  if (target.startsWith('base.')) {
    const k = target.slice(5) as BaseSegmentKey
    return BASE_SEGMENTS.find((s) => s.key === k)!
  }
  const k = target.slice(8) as ComboSegmentKey
  return COMBO_SEGMENTS.find((s) => s.key === k)!
}

const ALL_FIELDS = new Map<string, FieldDef>()
for (
  const s of [
    ...BASE_SEGMENTS,
    ...COMBO_SEGMENTS,
    EXPRESSION_SEGMENT,
    ACTION_SEGMENT,
  ]
) {
  for (const field of s.fields) ALL_FIELDS.set(field.key, field)
}

export function fieldDef(key: string): FieldDef | undefined {
  return ALL_FIELDS.get(key)
}

export function allFieldKeys(): string[] {
  return [...ALL_FIELDS.keys()]
}

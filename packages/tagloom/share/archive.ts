// 两种存档：
// A. 人物存档（tagloom.project）：本工具自己的数据结构，导出后再导入可恢复全部编辑资料。
// B. 下游成品（tagloom.output）：用户确认的最终表达与完整角色 Prompt 快照，发型覆盖已应用，
//    下游不需要理解所选 tag、候选或覆盖规则；不能用来恢复项目。
import {
  assembleBase,
  assembleCombo,
  assembleState,
  negativeText,
  segmentText,
} from './assemble.ts'
import type { Character } from './model.ts'
import { displayTitle } from './model.ts'
import { ARCHIVE_VERSION, OUTPUT_FORMAT, PROJECT_FORMAT } from './formats.ts'

export interface ProjectArchive {
  format: typeof PROJECT_FORMAT
  formatVersion: number
  exportedAt: number
  // 不含服务端维护的 AI 变更记录（userVersion / agentChanges）和文件路径
  character: Omit<Character, 'path' | 'userVersion' | 'agentChanges'>
}

export interface OutputState {
  id: string
  name: string
  note: string
  // 有效种子（状态种子优先，否则人物种子；含 0）；两者都没有则省略
  seed?: number
  expression: string
  action: string
  // 已应用覆盖的有效 Base 与服装
  base: string
  costume: string
  costumePrompt: string
  fullPrompt: string
}

export interface OutputArchive {
  format: typeof OUTPUT_FORMAT
  formatVersion: number
  exportedAt: number
  // 导出时的项目版本，便于对照；成品不随之后的编辑变化
  sourceVersion: number
  character: {
    title: string
    subject: string
    // 负面 Prompt（所有组合、状态共用）；没写时为空字符串
    negativePrompt: string
    // 人物默认种子；未设置时省略
    seed?: number
    base: {
      hair: string
      eyes: string
      body: string
      other: string
      prompt: string
    }
    combos: {
      id: string
      name: string
      hairSource: 'base' | 'override'
      // 有效头发段（已应用覆盖）
      hair: string
      // 有效 Base（已应用覆盖）
      base: string
      costume: Record<string, string>
      costumePrompt: string
      fullPrompt: string
      // 仅在组合有状态时出现；每个状态是已解析的最终结果
      states?: OutputState[]
    }[]
  }
}

function projectCharacter(c: Character): ProjectArchive['character'] {
  const { path: _p, userVersion: _u, agentChanges: _a, ...rest } = c
  return {
    ...rest,
    stylePrompt: c.stylePrompt ?? '',
    negativePrompt: c.negativePrompt ?? '',
  }
}

export function buildProjectArchive(c: Character, now: number): ProjectArchive {
  return {
    format: PROJECT_FORMAT,
    formatVersion: ARCHIVE_VERSION,
    exportedAt: now,
    character: projectCharacter(c),
  }
}

export function buildOutputArchive(c: Character, now: number): OutputArchive {
  const seg = c.base.segments
  return {
    format: OUTPUT_FORMAT,
    formatVersion: ARCHIVE_VERSION,
    exportedAt: now,
    sourceVersion: c.version,
    character: {
      title: displayTitle(c),
      subject: c.base.subject.trim(),
      negativePrompt: negativeText(c),
      ...(c.seed !== undefined ? { seed: c.seed } : {}),
      base: {
        hair: segmentText(seg.hair),
        eyes: segmentText(seg.eyes),
        body: segmentText(seg.body),
        other: segmentText(seg.other),
        prompt: assembleBase(c),
      },
      combos: c.combos.map((combo) => {
        const a = assembleCombo(c, combo)
        return {
          id: combo.id,
          name: combo.name,
          hairSource: a.hairSource as 'base' | 'override',
          hair: a.baseParts.find((p) => p.key === 'hair')?.text ?? '',
          base: a.base,
          costume: Object.fromEntries(
            a.costumeParts.filter((p) => p.text).map((p) => [p.key, p.text]),
          ),
          costumePrompt: a.costume,
          fullPrompt: a.full,
          ...((combo.states ?? []).length > 0
            ? {
              states: combo.states.map((state): OutputState => {
                const r = assembleState(c, combo, state)
                return {
                  id: state.id,
                  name: state.name,
                  note: state.note,
                  ...(r.effectiveSeed !== undefined
                    ? { seed: r.effectiveSeed }
                    : {}),
                  expression: r.expression,
                  action: r.action,
                  base: r.base,
                  costume: r.costume,
                  costumePrompt: r.costume,
                  fullPrompt: r.full,
                }
              }),
            }
            : {}),
        }
      }),
    },
  }
}

// 纯文本成品：每个组合一段完整角色 Prompt，便于直接复制
export function buildOutputText(c: Character): string {
  const lines: string[] = [`# ${displayTitle(c)}`]
  if (c.base.subject.trim()) lines.push(`Subject: ${c.base.subject.trim()}`)
  if (c.seed !== undefined) lines.push(`Seed: ${c.seed}`)
  if (negativeText(c)) lines.push(`Negative: ${negativeText(c)}`)
  lines.push('', `## Base`, assembleBase(c))
  for (const combo of c.combos) {
    const a = assembleCombo(c, combo)
    lines.push(
      '',
      `## ${combo.name || '未命名组合'}${
        a.hairSource === 'override' ? '（发型覆盖）' : ''
      }`,
      `Base: ${a.base}`,
      `Outfit: ${a.costume}`,
      `Prompt: ${a.full}`,
    )
    for (const state of combo.states ?? []) {
      const r = assembleState(c, combo, state)
      lines.push(
        '',
        `### ${combo.name || '未命名组合'} / ${state.name || '未命名状态'}`,
        ...(r.effectiveSeed !== undefined ? [`Seed: ${r.effectiveSeed}`] : []),
        `Base: ${r.base}`,
        `Outfit: ${r.costume}`,
        `Expression: ${r.expression}`,
        `Action: ${r.action}`,
        `Prompt: ${r.full}`,
      )
    }
  }
  return lines.join('\n') + '\n'
}

// core/src/recognition/pool_memory.ts
// 一局的技能池记忆。池子满的时候认一次并记住;之后的扫描只做两件事:
//   - 补上之前没认出来的格;
//   - 看哪些格变空了(= 被选走了)。
// 已经认出来的格不再改——选到一半画面变暗、有遮挡,都不会把结果弄乱。
import type { PoolReading } from "./pool_resolve";

export interface PoolSnapshot {
  /** 48 格记住的技能名(顺序同 readPool);从没认出来过的为 null。 */
  names: (string | null)[];
  /** 该格的技能现在是否还在池子里(最近一次扫描里这格不是空的)。 */
  available: boolean[];
  /** 英雄位置编号 → 认定的 hero_id(未认定为 null)。 */
  heroes: Map<number, number | null>;
  /** 本次扫描是否被判为「新的一局」而清空了旧记忆。 */
  reset: boolean;
}

// 新扫描里「认出来了、但和记忆不一样」的格达到这个数,就认为换了一局,清空重来。
// 同一局里已认出的格不会变成另一个技能;零星 1–2 格不同更可能是遮挡造成的误读,不值得清空。
export const NEW_DRAFT_MISMATCH = 4;

export class PoolMemory {
  private names: (string | null)[] = [];
  private heroes = new Map<number, number | null>();

  /** 记忆里这个位置已认定的英雄(没有为 null)。 */
  knownHero(heroPos: number): number | null {
    return this.heroes.get(heroPos) ?? null;
  }

  reset(): void {
    this.names = [];
    this.heroes = new Map();
  }

  /** 并入一次扫描结果,返回当前这局的结论。 */
  observe(reading: PoolReading): PoolSnapshot {
    const { cells, groups } = reading;
    let mismatch = 0;
    cells.forEach((c, i) => {
      const old = this.names[i] ?? null;
      if (old !== null && c.name !== null && c.name !== old) mismatch++;
    });
    const reset = mismatch >= NEW_DRAFT_MISMATCH;
    if (reset) this.reset();

    cells.forEach((c, i) => {
      if ((this.names[i] ?? null) === null) this.names[i] = c.name; // 只补空,不覆盖
    });
    for (const g of groups) {
      if ((this.heroes.get(g.hero) ?? null) === null) this.heroes.set(g.hero, g.heroId);
    }
    return {
      names: [...this.names],
      available: cells.map((c) => !c.empty),
      heroes: new Map(this.heroes),
      reset,
    };
  }
}

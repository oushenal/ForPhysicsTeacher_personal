/* ============================================================
   physics · 连接与外部地址配置
   ------------------------------------------------------------
   🔴 全站所有「站外地址」都集中在这里，别在别的文件里写死网址。
   ============================================================ */
window.PHYSICS_CONFIG = {

  /* ---------- 作业发布：沿用现有线上地址，站内只做跳转 ---------- */
  publish: {
    url: 'https://18730003273146f4a7247dcce0b542fa.app.workbuddy.host',
    external: true,   // true = 新标签页打开；false = 站内打开（暂未实现）
  },

  /* ---------- 杂项里的外链 ----------
     加一条就往这个数组里加一项，不用改别的代码。 */
  links: [
    {
      name: '住宿生大巴点名表',
      url: 'https://oushenal.github.io/BusList/',
      desc: '住宿生上车点名，按线路分页',
      group: '点名 · 名单',
    },
  ],

  /* ---------- Supabase（成绩归档 / 作业登记用） ----------
     ⚠️ url 只填到**域名**，不要带 /rest/v1/ 尾巴 ——
        supabase-js 会自己拼 /rest/v1/...，多一段就全错。
     只填 publishable(anon) key —— 它设计为可公开，配合数据库 RLS 使用。
     🔴 绝不能把 service_role / secret key 写在这里。 */
  supabase: {
    url: 'https://lpnyfeaenuypzukjkolp.supabase.co',
    key: 'sb_publishable_CANRKaz-aDrnGcv2dRpyvg_dbqzqgaV',
  },

  /* ---------- 物理演示的存放位置（GitHub 仓库内路径） ----------
     页面打开时会去列这个目录，把文件放进去就自动出现，不用改代码。
     见 可行性讨论.md 第 1 节。
     ⚠️ 仓库还没建（2026-10-16 核实 oushenal/teacher-workbench 返回 404）。
        建好并把文件推上去之前，列表会走 apps/physics/demos.json 兜底。 */
  repo: {
    owner: 'oushenal',
    name: 'teacher-workbench',
    branch: 'main',
    demosPath: 'apps/physics/demos',
  },
};

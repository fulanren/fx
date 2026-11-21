import { el, clear } from '../utils/dom.js';
import { navigate } from '../router.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { confirmBox } from '../ui/confirm.js';

const STORAGE_KEY = 'kg_exam_countdowns';

export function renderCountdownPage() {
  const view = document.getElementById('view');
  clear(view);
  document.getElementById('page-title').textContent = '⏰ 倒计时管理';
  document.getElementById('btn-back').classList.remove('hidden');
  document.getElementById('btn-back').onclick = () => navigate('#/');

  let countdowns = [];
  try { countdowns = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { }

  let isManageMode = false;
  let selectedIds = new Set();

  const renderPage = () => {
    view.innerHTML = '';

    // ================= 1. 顶部工具栏 =================
    view.appendChild(el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' } }, [
      el('div', { style: { display: 'flex', gap: '8px' } }, [
        el('button', { class: 'btn btn-primary', text: '➕ 新增倒计时', onClick: () => openEditModal(null) }),
        el('button', {
          class: `btn ${isManageMode ? 'btn-danger' : 'btn-ghost'}`,
          text: isManageMode ? '✖ 退出管理' : '⚙️ 管理',
          onClick: () => { isManageMode = !isManageMode; selectedIds.clear(); renderPage(); }
        })
      ])
    ]));

    // ================= 2. 批量操作栏 =================
    if (isManageMode) {
      view.appendChild(el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '8px', padding: '12px', background: 'rgba(239,71,111,0.08)', borderRadius: '10px', marginBottom: '16px', border: '1px solid rgba(239,71,111,0.2)' } }, [
        el('div', { style: { width: '100%', fontSize: '13px', fontWeight: '600', color: 'var(--danger)', marginBottom: '4px' } }, [
          `已选中 ${selectedIds.size} 个倒计时`
        ]),
        el('button', { class: 'btn btn-sm btn-ghost', text: '全选', onClick: () => { countdowns.forEach(c => selectedIds.add(c.id)); renderPage(); } }),
        el('button', { class: 'btn btn-sm btn-ghost', text: '全不选', onClick: () => { selectedIds.clear(); renderPage(); } }),
        el('button', {
          class: 'btn btn-sm btn-ghost', text: '📋 复制', onClick: () => {
            if (selectedIds.size === 0) return toastError('请先勾选');
            const items = countdowns.filter(c => selectedIds.has(c.id));
            localStorage.setItem('kg_clipboard_countdowns', JSON.stringify(items));
            toastSuccess(`已复制 ${items.length} 个倒计时`);
          }
        }),
        el('button', {
          class: 'btn btn-sm btn-ghost', text: '📥 粘贴', onClick: async () => {
            const raw = localStorage.getItem('kg_clipboard_countdowns');
            if (!raw) return toastError('剪贴板里没有倒计时');
            const items = JSON.parse(raw);
            if (await confirmBox({ title: '粘贴', message: `要粘贴 ${items.length} 个倒计时吗？` })) {
              items.forEach(item => {
                countdowns.push({ ...item, id: crypto.randomUUID() });
              });
              save();
              selectedIds.clear();
              renderPage();
              toastSuccess('粘贴成功');
            }
          }
        }),
        el('button', {
          class: 'btn btn-sm btn-danger', text: '🗑 删除', onClick: async () => {
            if (selectedIds.size === 0) return toastError('请先勾选');
            if (await confirmBox({ title: '删除', message: `确定删除选中的 ${selectedIds.size} 个倒计时吗？` })) {
              countdowns = countdowns.filter(c => !selectedIds.has(c.id));
              save();
              selectedIds.clear();
              renderPage();
              toastSuccess('已删除');
            }
          }
        })
      ]));
    }

    // ================= 3. 列表渲染 =================
    if (countdowns.length === 0) {
      view.appendChild(el('div', { style: { textAlign: 'center', padding: '40px', color: 'var(--text-2)' }, text: '暂无倒计时，点击上方按钮新增。' }));
      return;
    }

    countdowns.forEach(cd => {
      const isSelected = selectedIds.has(cd.id);
      const diff = new Date(cd.date).getTime() - Date.now();
      const days = diff > 0 ? Math.ceil(diff / (1000 * 60 * 60 * 24)) : 0;
      const isPinned = cd.isPinned !== false; // 默认显示，如果没有该字段就默认显示

      const card = el('div', {
        style: {
          display: 'flex', alignItems: 'center', padding: '12px 16px', marginBottom: '8px',
          background: isSelected ? 'rgba(239,71,111,0.05)' : 'var(--card)',
          border: `1px solid ${isSelected ? 'var(--danger)' : 'rgba(0,0,0,0.05)'}`,
          borderRadius: '10px', cursor: isManageMode ? 'pointer' : 'default'
        },
        onClick: (e) => {
          if (isManageMode) {
            if (e.target.tagName === 'BUTTON') return;
            if (isSelected) selectedIds.delete(cd.id);
            else selectedIds.add(cd.id);
            renderPage();
          }
        }
      }, [
        isManageMode ? el('input', { type: 'checkbox', checked: isSelected, style: { marginRight: '12px', width: '18px', height: '18px', accentColor: 'var(--danger)', pointerEvents: 'none' } }) : null,
        el('div', { style: { flex: '1' } }, [
          el('div', { text: cd.name, style: { fontWeight: '600', fontSize: '16px' } }),
          el('div', { text: cd.date + (cd.target ? ` | 目标: ${cd.target}` : ''), style: { fontSize: '12px', color: 'var(--text-2)', marginTop: '4px' } })
        ]),

        // 侧边栏显示开关 (不在批量管理模式下显示)
        !isManageMode ? el('label', { style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--text-2)', marginRight: '12px', cursor: 'pointer' } }, [
          el('input', {
            type: 'checkbox',
            checked: isPinned,
            onChange: (e) => {
              e.stopPropagation();
              // 直接在内存中修改并保存到 localStorage
              const idx = countdowns.findIndex(c => c.id === cd.id);
              if (idx >= 0) {
                countdowns[idx].isPinned = e.target.checked;
                save();
                toastSuccess(e.target.checked ? '已显示在侧边栏' : '已从侧边栏隐藏');
              }
            }
          }),
          el('span', { text: '侧边栏显示' })
        ]) : null,

        el('div', { style: { textAlign: 'right', color: 'var(--danger)' } }, [
          el('div', { text: `${days}`, style: { fontSize: '24px', fontWeight: '800', lineHeight: '1' } }),
          el('div', { text: '天', style: { fontSize: '12px' } })
        ]),

        !isManageMode ? el('div', { style: { display: 'flex', gap: '4px', marginLeft: '12px' } }, [
          el('button', { class: 'btn btn-sm btn-ghost', text: '✏️', onClick: (e) => { e.stopPropagation(); openEditModal(cd); } }),
          el('button', {
            class: 'btn btn-sm btn-ghost', text: '🗑', style: { color: 'var(--danger)' }, onClick: async (e) => {
              e.stopPropagation();
              if (await confirmBox({ title: '删除', message: '确定删除吗？' })) {
                countdowns = countdowns.filter(c => c.id !== cd.id);
                save();
                renderPage();
              }
            }
          })
        ]) : null
      ]);
      view.appendChild(card);
    });
  };

  const save = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(countdowns));
  };

  const openEditModal = (cd) => {
    const isNew = !cd;
    const current = cd || { id: crypto.randomUUID(), name: '', date: '', target: '' };

    const mask = el('div', { class: 'confirm-mask' });
    const nameInput = el('input', { type: 'text', value: current.name, placeholder: '如：2026 国考', style: { width: '100%', marginBottom: '12px', padding: '10px', border: '1px solid #ccc', borderRadius: '8px', outline: 'none' } });
    const dateInput = el('input', { type: 'date', value: current.date, style: { width: '100%', marginBottom: '12px', padding: '10px', border: '1px solid #ccc', borderRadius: '8px', outline: 'none' } });
    const targetInput = el('input', { type: 'text', value: current.target || '', placeholder: '如：行测 70+', style: { width: '100%', marginBottom: '16px', padding: '10px', border: '1px solid #ccc', borderRadius: '8px', outline: 'none' } });

    mask.appendChild(el('div', { class: 'confirm-box' }, [
      el('h3', { text: isNew ? '新增倒计时' : '编辑倒计时' }),
      el('div', { style: { fontSize: '13px', color: 'var(--text-2)', marginBottom: '12px' }, text: '设置你的考试目标，侧边栏会实时显示。' }),
      nameInput, dateInput, targetInput,
      el('div', { class: 'confirm-actions' }, [
        el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
        el('button', {
          class: 'btn btn-primary', text: '保存', onClick: () => {
            if (!dateInput.value) return toastError('请选择考试日期');
            current.name = nameInput.value.trim() || '目标考试';
            current.date = dateInput.value;
            current.target = targetInput.value.trim();

            if (isNew) countdowns.push(current);
            else {
              const idx = countdowns.findIndex(c => c.id === current.id);
              if (idx >= 0) countdowns[idx] = current;
            }
            save();
            mask.remove();
            renderPage();
            toastSuccess('已保存');
          }
        })
      ])
    ]));
    document.body.appendChild(mask);
  };

  renderPage();
}
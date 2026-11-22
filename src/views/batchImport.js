import { el } from '../utils/dom.js';
import * as store from '../store.js';
import { navigate } from '../router.js';
import { toastSuccess, toastError } from '../ui/toast.js';
import { confirmBox } from '../ui/confirm.js';

export function batchImportModal(chapterId = null) {
    const currentChapterId = chapterId;
    let targetMode = currentChapterId ? 'current' : 'new'; // 默认选中：如果有当前章节选当前，没有就默认新建
    let selectedOtherChapterId = null;
    let selectedOtherTaskName = '';

    const textarea = el('textarea', {
        placeholder: '每行一个知识点，或用空行分隔\n\n例如：\n宪法是国家的根本法\n全国人民代表大会是最高权力机关',
        style: { width: '100%', minHeight: '160px', padding: '12px', fontSize: '14px', border: '1px solid rgba(0,0,0,.1)', borderRadius: '10px', fontFamily: 'inherit', resize: 'vertical' },
        onInput: () => updatePreview()
    });

    const preview = el('div', { style: { fontSize: '13px', color: 'var(--primary-dark)', padding: '8px', background: 'rgba(142,202,230,.15)', borderRadius: '8px', margin: '12px 0', fontWeight: '600' } });

    function updatePreview() {
        const items = splitText();
        preview.textContent = `📝 预计将生成 ${items.length} 个知识点`;
    }

    function splitText() {
        const t = textarea.value;
        if (!t.trim()) return [];
        return t.split('\n').map(s => s.trim()).filter(Boolean);
    }

    // ================= 归档位置选择 UI (带强提示) =================
    const targetSection = el('div', {
        style: { display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }
    });

    function renderTargetOptions() {
        targetSection.innerHTML = '';

        // 1. 当前章节
        if (currentChapterId) {
            targetSection.appendChild(el('div', {
                style: { padding: '12px', background: targetMode === 'current' ? 'rgba(142,202,230,.15)' : 'var(--bg)', border: `1px solid ${targetMode === 'current' ? 'var(--primary)' : 'rgba(0,0,0,0.05)'}`, borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' },
                onClick: () => { targetMode = 'current'; renderTargetOptions(); }
            }, [
                el('input', { type: 'radio', checked: targetMode === 'current', style: { width: '18px', height: '18px' }, readOnly: true }),
                el('div', { style: { display: 'flex', flexDirection: 'column' } }, [
                    el('span', { style: { fontWeight: '600', fontSize: '14px' }, text: '📁 导入到当前所在文件夹' }),
                    targetMode === 'current' ? el('span', { style: { fontSize: '11px', color: 'var(--primary-dark)' }, text: '✅ 将直接存入你刚才浏览的章节' }) : null
                ])
            ]));
        }

        // 2. 选择其他文件夹
        targetSection.appendChild(el('div', {
            style: { padding: '12px', background: targetMode === 'other' ? 'rgba(142,202,230,.15)' : 'var(--bg)', border: `1px solid ${targetMode === 'other' ? 'var(--primary)' : 'rgba(0,0,0,0.05)'}`, borderRadius: '8px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' },
            onClick: (e) => {
                if (e.target.tagName === 'BUTTON') return;
                targetMode = 'other';
                renderTargetOptions();
            }
        }, [
            el('input', { type: 'radio', checked: targetMode === 'other', style: { width: '18px', height: '18px' }, readOnly: true }),
            el('div', { style: { display: 'flex', flexDirection: 'column', flex: '1', minWidth: '120px' } }, [
                el('span', { style: { fontWeight: '600', fontSize: '14px' }, text: '📂 选择其他文件夹' }),
                targetMode === 'other' ? el('span', { style: { fontSize: '11px', color: selectedOtherChapterId ? 'var(--primary-dark)' : 'var(--danger)' }, text: selectedOtherChapterId ? `✅ 已选：${selectedOtherTaskName}` : '⚠️ 请点击右侧按钮选择目标' }) : null
            ]),
            el('button', {
                class: 'btn btn-sm btn-ghost', text: selectedOtherChapterId ? '重选' : '🔍 选择',
                style: { flexShrink: '0' },
                onClick: (e) => {
                    e.stopPropagation();
                    const tasks = store.getTasks();
                    if (tasks.length === 0) return toastError('还没有创建任何文件夹');

                    const mask = el('div', { class: 'confirm-mask', style: { zIndex: 999999 } });
                    const list = el('div', { style: { maxHeight: '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', margin: '12px 0' } });

                    tasks.forEach(t => {
                        // 渲染文件夹本身（点击直接选定该文件夹）
                        list.appendChild(el('div', {
                            style: { fontWeight: '600', fontSize: '13px', padding: '8px 12px', background: 'rgba(142,202,230,.1)', borderRadius: '6px', cursor: 'pointer', marginTop: '4px' },
                            text: `📁 ${t.name}`,
                            onClick: () => {
                                const chapters = store.getChapters(t.id);
                                // 自动找它的“默认”章节，或者第一个章节
                                const defChap = chapters.find(c => c.name === '默认' || c.name === '默认子模块') || chapters[0];

                                if (defChap) {
                                    selectedOtherChapterId = defChap.id;
                                } else {
                                    // 如果文件夹里面一个章节都没，直接给它建一个隐形默认章节
                                    selectedOtherChapterId = store.createChapter({ taskId: t.id, name: '默认' }).id;
                                }
                                selectedOtherTaskId = t.id;
                                selectedOtherTaskName = t.name;
                                targetMode = 'other';
                                mask.remove();
                                renderTargetOptions();
                            }
                        }));
                    });

                    const box = el('div', { class: 'confirm-box', style: { maxWidth: '400px' } }, [
                        el('h3', { text: '选择目标文件夹' }), list,
                        el('div', { class: 'confirm-actions' }, [el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() })])
                    ]);
                    mask.appendChild(box);
                    document.body.appendChild(mask);
                }
            })
        ]));

        // 3. 新建文件夹
        targetSection.appendChild(el('div', {
            style: { padding: '12px', background: targetMode === 'new' ? 'rgba(142,202,230,.15)' : 'var(--bg)', border: `1px solid ${targetMode === 'new' ? 'var(--primary)' : 'rgba(0,0,0,0.05)'}`, borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' },
            onClick: () => { targetMode = 'new'; renderTargetOptions(); }
        }, [
            el('input', { type: 'radio', checked: targetMode === 'new', style: { width: '18px', height: '18px' }, readOnly: true }),
            el('div', { style: { display: 'flex', flexDirection: 'column' } }, [
                el('span', { style: { fontWeight: '600', fontSize: '14px' }, text: '➕ 新建文件夹并归入' }),
                targetMode === 'new' ? el('span', { style: { fontSize: '11px', color: 'var(--text-2)' }, text: '点击“开始导入”时会弹窗让你输入文件夹名字' }) : null
            ])
        ]));
    }

    renderTargetOptions();

    let isImporting = false;
    const importBtn = el('button', {
        class: 'btn btn-primary', text: '开始导入',
        onClick: async () => {
            if (isImporting) return;

            const items = splitText();
            if (items.length === 0) { toastError('请先在输入框里粘贴要导入的内容'); textarea.focus(); return; }

            let finalChapterId = currentChapterId;
            let finalTargetName = '当前文件夹';

            if (targetMode === 'current') {
                if (!currentChapterId) return toastError('当前没有归属文件夹，请选择其他文件夹或新建');
            } else if (targetMode === 'other') {
                if (!selectedOtherChapterId) return toastError('你还没选文件夹！请点击「🔍 选择」');
                finalChapterId = selectedOtherChapterId;
                finalTargetName = selectedOtherTaskName;
            } else if (targetMode === 'new') {
                const folderName = prompt('请输入新文件夹名称：');
                if (!folderName || !folderName.trim()) return toastError('必须输入文件夹名称才能导入');
                const newName = folderName.trim();

                isImporting = true;
                importBtn.textContent = '正在创建文件夹...';
                importBtn.style.opacity = '0.7';

                const newTask = store.createTask({ name: newName });
                const newChap = store.createChapter({ taskId: newTask.id, name: newName });
                finalChapterId = newChap.id;
                finalTargetName = newName;
            }

            if (!await confirmBox({
                title: '确认导入',
                message: `将创建 ${items.length} 个知识点，并归入「${finalTargetName}」。`,
                confirmText: '确认导入'
            })) {
                isImporting = false;
                importBtn.textContent = '开始导入';
                importBtn.style.opacity = '1';
                return;
            }

            isImporting = true;
            importBtn.textContent = '正在导入，请稍候...';
            importBtn.style.opacity = '0.7';
            const mask = document.querySelector('.confirm-mask'); // 获取当前弹窗
            if (mask) mask.style.pointerEvents = 'none'; // 锁死弹窗

            try {
                await new Promise(r => setTimeout(r, 100));
                for (const content of items) {
                    store.createPoint({ chapterId: finalChapterId, content, explanation: '' });
                }
                toastSuccess(`成功导入 ${items.length} 个知识点！`);
                if (finalChapterId) navigate(`#/chapter/${finalChapterId}`);
                else navigate(`#/`);
            } catch (err) {
                console.error(err);
                toastError('导入过程中发生错误：' + err.message);
                if (mask) mask.style.pointerEvents = 'auto';
                isImporting = false;
                importBtn.textContent = '重新导入';
                importBtn.style.opacity = '1';
            }
        }
    });

    const mask = el('div', { class: 'confirm-mask' }, [
        el('div', { class: 'confirm-box', style: { maxWidth: '600px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' } }, [
            el('h3', { text: '📋 批量导入知识点' }),
            el('p', { text: '粘贴文本，自动拆分成多个知识点卡片', style: { fontSize: '13px', color: 'var(--text-2)' } }),

            el('div', { style: { overflowY: 'auto', flex: '1', paddingRight: '4px' } }, [
                textarea,
                preview,
                el('div', { style: { fontWeight: '600', fontSize: '14px', marginBottom: '8px', marginTop: '12px' }, text: '📁 归档位置（选择你要存到哪里）' }),
                targetSection
            ]),

            el('div', { class: 'confirm-actions', style: { marginTop: '16px', flexShrink: '0' } }, [
                el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => mask.remove() }),
                importBtn
            ]),
        ]),
    ]);

    document.body.appendChild(mask);
    updatePreview();
    textarea.focus();
}
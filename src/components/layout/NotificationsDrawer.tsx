import { useStore, toast } from '../../store/store';
import { closeDrawer } from '../ui/Overlay';
import { Icon } from '../ui/Icon';
import { ICON } from '../../lib/svg';
import { initials } from '../../lib/utils';
import { useNotifications } from '../../hooks/useNotifications';

/* ═══════════════════════════════════════════════════════════════
   Notifications drawer — real notification data via useNotifications
   (store-backed). Mark-read / remove target the DB row by uuid; the
   store is updated through the hook so it stays in sync with the
   topbar badge.
   ═══════════════════════════════════════════════════════════════ */

export function NotificationsDrawerBody() {
  const { s } = useStore();
  const { status, markRead, markAll, remove } = useNotifications();
  const unread = s.notifications.filter((n) => !n.read).length;

  const onMarkRead = async (id: string) => {
    if (await markRead(id)) toast('Notification marked as read.', 'info', 'Read');
  };
  const onRemove = async (id: string) => {
    if (await remove(id)) toast('Notification removed.', 'info', 'Removed');
  };
  const onMarkAll = async () => {
    if (await markAll()) toast('All notifications marked as read.', 'success', 'Done');
  };

  return (
    <>
      <div className="drawer-head">
        <div>
          <h3>Notifications</h3>
          <span className="num">{unread} unread</span>
        </div>
        <div className="drawer-head-actions">
          <button className="btn btn-ghost btn-sm" onClick={onMarkAll}>
            Read all
          </button>
          <button className="icon-btn" onClick={closeDrawer} aria-label="Close">
            <Icon d={ICON.close} strokeWidth={1.8} />
          </button>
        </div>
      </div>
      <div className="drawer-body" id="notifList">
        {status === 'loading' || status === 'idle' ? (
          <div style={{ color: 'var(--muted)', fontSize: 14, padding: '22px 0', textAlign: 'center' }}>
            Loading notifications…
          </div>
        ) : status === 'error' ? (
          <div style={{ color: 'var(--error)', fontSize: 14, padding: '22px 0', textAlign: 'center' }}>
            Could not load notifications.
          </div>
        ) : s.notifications.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 14, padding: '22px 0', textAlign: 'center' }}>
            You are all caught up.
          </div>
        ) : (
          s.notifications.map((n) => (
            <div
              key={n.id ?? n.msg + n.time}
              className={'notif-row' + (n.read ? ' read' : '')}
              role="button"
              tabIndex={0}
              onClick={() => n.id && onMarkRead(n.id)}
            >
              <div className="avatar" style={{ width: 30, height: 30, fontSize: 12, flexShrink: 0 }}>
                {initials(n.msg.replace(/[^A-Za-z0-9 ]/g, ''))}
              </div>
              <div className="n-body">
                <div className="n-msg">{n.msg}</div>
                <div className="n-time">
                  {n.time}
                  {!n.read ? (
                    <span className="badge badge-gold">New</span>
                  ) : (
                    <span />
                  )}
                </div>
              </div>
              <button
                className="notif-remove"
                title="Remove notification"
                onClick={(e) => {
                  e.stopPropagation();
                  if (n.id) onRemove(n.id);
                }}
              >
                <Icon d={ICON.close} strokeWidth={2} />
              </button>
            </div>
          ))
        )}
      </div>
    </>
  );
}

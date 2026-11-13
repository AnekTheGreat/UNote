package app.unote;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * Fires when a reminder's time comes and posts it as a notification. The alarm was armed by
 * Reminders.arm(); tapping the notification opens UNote on whatever was last open.
 */
public class ReminderReceiver extends BroadcastReceiver {

    static final String CHANNEL = "unote-reminders";
    static final String EXTRA_TEXT = "text";
    static final String EXTRA_ID = "id";

    @Override
    public void onReceive(Context c, Intent intent) {
        String text = intent == null ? null : intent.getStringExtra(EXTRA_TEXT);
        String id = intent == null ? null : intent.getStringExtra(EXTRA_ID);
        if (text == null || text.trim().isEmpty()) {
            text = "It is time.";
        }
        if (id != null) {
            Reminders.cancel(c, id);          // it has spoken, so it is not to speak again
        }
        show(c, text);
    }

    static void channel(Context c) {
        if (Build.VERSION.SDK_INT < 26) {
            return;
        }
        NotificationManager m = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (m == null || m.getNotificationChannel(CHANNEL) != null) {
            return;
        }
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Reminders",
                NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("The reminders you wrote in UNote.");
        m.createNotificationChannel(ch);
    }

    static void show(Context c, String text) {
        try {
            channel(c);
            NotificationManager m = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (m == null) {
                return;
            }
            Intent open = new Intent(c, MainActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 23) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent pi = PendingIntent.getActivity(c, (int) (System.currentTimeMillis() & 0xffff),
                    open, flags);
            Notification.Builder b = Build.VERSION.SDK_INT >= 26
                    ? new Notification.Builder(c, CHANNEL)
                    : new Notification.Builder(c);
            b.setSmallIcon(android.R.drawable.ic_popup_reminder)
                    .setContentTitle("UNote reminder")
                    .setContentText(text)
                    .setStyle(new Notification.BigTextStyle().bigText(text))
                    .setAutoCancel(true)
                    .setContentIntent(pi);
            m.notify((int) (System.currentTimeMillis() & 0x7fffffff), b.build());
        } catch (Exception ignored) {
            // a phone that refuses the notification must not take the app down with it
        }
    }
}

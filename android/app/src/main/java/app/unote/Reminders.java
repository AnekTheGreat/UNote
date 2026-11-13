package app.unote;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import java.util.ArrayList;

/**
 * The reminders the page has set, on the phone's own clock.
 *
 * A page cannot wake a phone that is not running, so every reminder the page holds is also handed
 * here, written to the app's preferences and given to AlarmManager. The preferences are the reason
 * the reboot case works: alarms are cleared when a phone restarts, but the list is not, so
 * BootReceiver reads the same list and arms the ones still to come.
 *
 * Nothing here is a network call and nothing leaves the phone: a reminder is a line of text and a
 * time, kept in this app's private storage.
 */
public class Reminders {

    static final String PREFS = "unote-reminders";

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Arm one reminder and remember it. The stored value is "<millis>|<text>". */
    static void set(Context c, String id, long at, String text) {
        if (id == null || id.isEmpty()) {
            return;
        }
        if (text == null || text.trim().isEmpty()) {
            text = "It is time.";
        }
        prefs(c).edit().putString(id, at + "|" + text).apply();
        arm(c, id, at, text);
    }

    static void cancel(Context c, String id) {
        if (id == null || id.isEmpty()) {
            return;
        }
        prefs(c).edit().remove(id).apply();
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) {
            return;
        }
        try {
            am.cancel(pending(c, id, 0, null));
        } catch (Exception ignored) {
            // the alarm was not armed: nothing to cancel
        }
    }

    static void cancelAll(Context c) {
        SharedPreferences p = prefs(c);
        // Copied first: cancel() edits the same preferences, and walking them while they change
        // throws.
        for (String id : new ArrayList<>(p.getAll().keySet())) {
            cancel(c, id);
        }
        p.edit().clear().apply();
    }

    /** Arm everything this phone already knows about whose time has not yet gone. */
    static void rearm(Context c) {
        SharedPreferences p = prefs(c);
        long now = System.currentTimeMillis();
        for (String id : new ArrayList<>(p.getAll().keySet())) {
            String v = p.getString(id, null);
            if (v == null) {
                continue;
            }
            int bar = v.indexOf('|');
            if (bar < 0) {
                continue;
            }
            try {
                long at = Long.parseLong(v.substring(0, bar));
                if (at > now) {
                    arm(c, id, at, v.substring(bar + 1));
                }
            } catch (Exception ignored) {
                // a record that cannot be read is not worth failing a boot over
            }
        }
    }

    static PendingIntent pending(Context c, String id, long at, String text) {
        Intent i = new Intent(c, ReminderReceiver.class);
        i.putExtra(ReminderReceiver.EXTRA_TEXT, text);
        i.putExtra(ReminderReceiver.EXTRA_ID, id);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.getBroadcast(c, id.hashCode(), i, flags);
    }

    static void arm(Context c, String id, long at, String text) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null || at <= System.currentTimeMillis()) {
            return;
        }
        PendingIntent pi = pending(c, id, at, text);
        try {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        } catch (SecurityException notAllowed) {
            // An exact alarm needs the phone's permission from Android 12; a nearly-exact one
            // always works, and a reminder a moment late beats one that never came.
            try {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } catch (Exception ignored) {
            }
        } catch (Exception ignored) {
        }
    }
}

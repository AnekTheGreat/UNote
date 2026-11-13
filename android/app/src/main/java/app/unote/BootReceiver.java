package app.unote;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * A reboot clears every alarm a phone was holding, which is the one gap in a reminder written months
 * ahead. The reminders themselves are kept in this app's preferences, so they are armed again here.
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context c, Intent intent) {
        if (intent == null || !Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            return;
        }
        Reminders.rearm(c);
    }
}

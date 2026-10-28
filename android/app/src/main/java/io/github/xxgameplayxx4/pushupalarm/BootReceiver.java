package io.github.xxgameplayxx4.pushupalarm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** AlarmManager forgets everything on reboot, update or clock change; schedule again. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Alarms.scheduleAll(context);
    }
}

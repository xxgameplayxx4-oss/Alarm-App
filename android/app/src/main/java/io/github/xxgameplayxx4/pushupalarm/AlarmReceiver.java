package io.github.xxgameplayxx4.pushupalarm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.core.content.ContextCompat;

public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        int id = intent.getIntExtra(Alarms.EXTRA_ID, 0);
        Intent ring = new Intent(context, AlarmService.class).setAction(AlarmService.ACTION_RING);
        ContextCompat.startForegroundService(context, ring);
        Alarms.onFired(context, id);
    }
}

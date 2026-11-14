package com.nfang.chatapp;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(AudioRoutePlugin.class);
        registerPlugin(MessageNotificationPlugin.class);
        super.onCreate(savedInstanceState);
    }}

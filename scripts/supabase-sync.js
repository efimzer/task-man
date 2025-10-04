import { supabase, getCurrentUser } from './supabase-client.js';

let realtimeChannel = null;

export const supabaseSync = {
  async loadState() {
    const user = await getCurrentUser();
    if (!user) {
      console.log('📭 No user, returning null state');
      return null;
    }

    console.log('📥 Loading state from Supabase for user:', user.email);

    const { data, error } = await supabase
      .from('states')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        console.log('📭 State not found, will create default');
        return null;
      }
      console.error('❌ Load state error:', error);
      throw error;
    }

    console.log('✅ Loaded state from Supabase');
    return {
      meta: data.meta || { version: 0, updatedAt: Date.now() },
      folders: data.folders || [],
      tasks: data.tasks || [],
      archivedTasks: data.archived_tasks || [],
      ui: data.ui || {}
    };
  },

  async saveState(state) {
    const user = await getCurrentUser();
    if (!user) {
      console.warn('⚠️ Cannot save: not authenticated');
      return;
    }

    const payload = {
      user_id: user.id,
      email: user.email,
      meta: state.meta,
      folders: state.folders,
      tasks: state.tasks,
      archived_tasks: state.archivedTasks,
      ui: state.ui
    };

    const { error } = await supabase
      .from('states')
      .upsert(payload, {
        onConflict: 'user_id',
        ignoreDuplicates: false
      });

    if (error) {
      console.error('❌ Save state error:', error);
      throw error;
    }

    console.log('💾 Saved state to Supabase');
  },

  async subscribe(onUpdate) {
    const user = await getCurrentUser();
    if (!user) {
      console.warn('⚠️ Cannot subscribe: not authenticated');
      return null;
    }

    // Отписаться от предыдущего канала
    if (realtimeChannel) {
      await supabase.removeChannel(realtimeChannel);
    }

    console.log('📡 Subscribing to realtime updates...');

    realtimeChannel = supabase
      .channel('states-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'states',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          console.log('🔔 Realtime update received:', payload.eventType);
          
          if (payload.new) {
            const newState = {
              meta: payload.new.meta,
              folders: payload.new.folders,
              tasks: payload.new.tasks,
              archivedTasks: payload.new.archived_tasks,
              ui: payload.new.ui
            };
            
            onUpdate(newState);
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('✅ Subscribed to realtime updates');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('❌ Realtime subscription error');
        } else {
          console.log('📡 Subscription status:', status);
        }
      });

    return realtimeChannel;
  },

  async unsubscribe() {
    if (realtimeChannel) {
      await supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
      console.log('📡 Unsubscribed from realtime');
    }
  }
};

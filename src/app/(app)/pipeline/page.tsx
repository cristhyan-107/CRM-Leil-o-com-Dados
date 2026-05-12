import { createServerSupabase } from '@/lib/supabase/server';
import PipelineBoard from '@/components/pipeline/pipeline-board';

export const metadata = { title: 'Pipeline - Leilão Ágil' };

export default async function PipelinePage() {
  const supabase = await createServerSupabase();
  
  // Fetch leads and their associated property title
  const { data: leads } = await supabase
    .from('leads')
    .select('*, properties(title)')
    .order('created_at', { ascending: false });

  // Fetch all properties for the filter
  const { data: properties } = await supabase
    .from('properties')
    .select('id, title')
    .order('title');

  // Fetch WhatsApp conversations (each row = one conversation card)
  const { data: conversations } = await supabase
    .from('whatsapp_chats')
    .select('id, remote_jid, chat_name, push_name, phone_number, last_message, last_message_at, pipeline_stage, unread_count, profile_pic_url')
    .eq('is_group', false)
    .order('last_message_at', { ascending: false });

  return (
    <div className="max-w-screen-2xl mx-auto h-[calc(100vh-8rem)] flex flex-col">
      <PipelineBoard 
        initialLeads={leads || []} 
        properties={properties || []}
        initialConversations={conversations || []}
      />
    </div>
  );
}

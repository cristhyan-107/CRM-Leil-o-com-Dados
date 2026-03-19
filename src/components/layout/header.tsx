'use client';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Menu, LogOut, User, Settings } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Link from 'next/link';

interface HeaderProps {
  user?: {
    email?: string;
    user_metadata?: {
      full_name?: string;
    };
  } | null;
  onMenuClick?: () => void;
}

export function Header({ user, onMenuClick }: HeaderProps) {
  const router = useRouter();
  const supabase = createClient();

  const name = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Usuário';
  const initials = name
    .split(' ')
    .map((n: string) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  async function handleLogout() {
    await supabase.auth.signOut();
    toast.success('Logout realizado');
    router.push('/');
    router.refresh();
  }

  return (
    <header className="h-16 border-b border-white/[0.06] bg-[#080d18]/80 backdrop-blur-xl flex items-center justify-between px-4 sm:px-6 sticky top-0 z-30">
      {/* Left */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-all"
        >
          <Menu className="w-5 h-5" />
        </button>
        <h1 className="text-sm font-medium text-gray-400 hidden sm:block">
          CRM Leilão Ágil
        </h1>
      </div>

      {/* Right */}
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-3 p-1.5 rounded-xl hover:bg-white/5 transition-all cursor-pointer outline-none">
            <div className="hidden sm:block text-right">
              <p className="text-sm font-medium text-gray-200 leading-none">{name}</p>
              <p className="text-xs text-gray-500 mt-0.5">{user?.email}</p>
            </div>
            <Avatar className="w-8 h-8 border border-white/10">
              <AvatarFallback className="bg-gradient-to-br from-blue-600 to-blue-800 text-white text-xs font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 bg-[#0d1220] border-white/10">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-gray-400 font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium text-gray-200">{name}</p>
                <p className="text-xs text-gray-500">{user?.email}</p>
              </div>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator className="bg-white/5" />
          <DropdownMenuItem className="cursor-pointer text-gray-300 focus:bg-white/5 focus:text-white" onClick={() => router.push('/settings')}>
            <Settings className="w-4 h-4 mr-2" /> Configurações
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-white/5" />
          <DropdownMenuItem
            onClick={handleLogout}
            className="cursor-pointer text-red-400 focus:bg-red-500/10 focus:text-red-400"
          >
            <LogOut className="w-4 h-4 mr-2" /> Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

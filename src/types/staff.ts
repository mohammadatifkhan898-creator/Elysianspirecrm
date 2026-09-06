export interface ActivityEntry {
  t: string;
  d: string;
}

export type MemberStatus = 'Active' | 'Pending' | 'Suspended';
export type InvStatus = 'Pending' | 'Accepted' | 'Expired' | 'Revoked';

export interface StaffMember {
  /** DB staff_members uuid; absent for static/seed/invite rows that have no persisted record. */
  id?: string;
  /** DB roles uuid; absent when there is no persisted role row. */
  roleId?: string;
  name: string;
  email: string;
  role: string;
  status: MemberStatus;
  inv?: InvStatus;
  last: string;
  joined: string;
  sent?: string;
  activity: ActivityEntry[];
}

export interface CustomRole {
  name: string;
  desc: string;
  perms: string[];
}

/** UI/feature state for the Staff & Roles page (mirrors StaffState). */
export interface StaffState {
  tab: 'team' | 'roles';
  members: StaffMember[];
  customRoles: CustomRole[];
  selectedRole: string;
  openMenu: number;
  perPage: number;
  page: number;
  search: string;
  fRole: string;
  fStatus: string;
  sort: 'name' | 'role' | 'joined';
  creatingCustom: boolean;
}

export interface PermissionCategory {
  cat: string;
  perms: string[];
}

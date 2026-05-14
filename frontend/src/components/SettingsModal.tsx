import React, { useState, useEffect } from 'react';
import { X, Save, User, Briefcase, GraduationCap, DollarSign, Settings as SettingsIcon } from 'lucide-react';
import { apiService } from '../services/api';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('contact');

  useEffect(() => {
    if (isOpen) {
      loadProfile();
    }
  }, [isOpen]);

  const loadProfile = async () => {
    setLoading(true);
    const data = await apiService.getProfile();
    setProfile(data);
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    const res = await apiService.updateProfile(profile);
    setSaving(false);
    if (res.ok) {
      onClose();
    } else {
      alert(res.message);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-sm anim-fade-in">
      <div className="w-full max-w-4xl bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <SettingsIcon className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-100">Profile Settings</h2>
              <p className="text-xs text-slate-500 font-medium">Manage your automation profile data</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5 text-slate-500 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar Tabs */}
          <div className="w-48 border-r border-white/5 p-3 space-y-1">
            <TabButton 
              active={activeTab === 'contact'} 
              onClick={() => setActiveTab('contact')}
              icon={User}
              label="Contact Info"
            />
            <TabButton 
              active={activeTab === 'experience'} 
              onClick={() => setActiveTab('experience')}
              icon={Briefcase}
              label="Experience"
            />
            <TabButton 
              active={activeTab === 'education'} 
              onClick={() => setActiveTab('education')}
              icon={GraduationCap}
              label="Education"
            />
            <TabButton 
              active={activeTab === 'salary'} 
              onClick={() => setActiveTab('salary')}
              icon={DollarSign}
              label="Salary & Prefs"
            />
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
            {loading ? (
              <div className="h-full flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
              </div>
            ) : profile ? (
              <div className="space-y-6">
                {activeTab === 'contact' && (
                  <div className="space-y-4 anim-fade-up">
                    <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-wider mb-4">Personal Details</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="First Name" value={profile.contact_info.first_name} onChange={v => setProfile({...profile, contact_info: {...profile.contact_info, first_name: v}})} />
                      <Field label="Last Name" value={profile.contact_info.last_name} onChange={v => setProfile({...profile, contact_info: {...profile.contact_info, last_name: v}})} />
                    </div>
                    <Field label="Email" value={profile.contact_info.email} onChange={v => setProfile({...profile, contact_info: {...profile.contact_info, email: v}})} />
                    <Field label="Phone" value={profile.contact_info.phone} onChange={v => setProfile({...profile, contact_info: {...profile.contact_info, phone: v}})} />
                    <Field label="Location" value={profile.contact_info.location} onChange={v => setProfile({...profile, contact_info: {...profile.contact_info, location: v}})} />
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="LinkedIn" value={profile.contact_info.linkedin} onChange={v => setProfile({...profile, contact_info: {...profile.contact_info, linkedin: v}})} />
                      <Field label="GitHub" value={profile.contact_info.github} onChange={v => setProfile({...profile, contact_info: {...profile.contact_info, github: v}})} />
                    </div>
                  </div>
                )}

                {activeTab === 'experience' && (
                  <div className="space-y-4 anim-fade-up">
                    <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-wider mb-4">Professional Background</h3>
                    <Field label="Total Years" value={profile.experience.total_years} onChange={v => setProfile({...profile, experience: {...profile.experience, total_years: parseInt(v)}})} type="number" />
                    <Field label="Recent Role" value={profile.experience.recent_role} onChange={v => setProfile({...profile, experience: {...profile.experience, recent_role: v}})} />
                    <Field label="Recent Company" value={profile.experience.recent_company} onChange={v => setProfile({...profile, experience: {...profile.experience, recent_company: v}})} />
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Skills (Comma separated)</label>
                      <textarea 
                        className="w-full bg-slate-950 border border-white/5 rounded-xl px-4 py-3 text-slate-200 text-sm focus:outline-none focus:border-indigo-500/50 transition-colors min-h-[100px]"
                        value={profile.experience.skills.join(', ')}
                        onChange={e => setProfile({...profile, experience: {...profile.experience, skills: e.target.value.split(',').map(s => s.trim())}})}
                      />
                    </div>
                  </div>
                )}

                {activeTab === 'education' && (
                  <div className="space-y-4 anim-fade-up">
                    <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-wider mb-4">Education</h3>
                    <Field label="Degree" value={profile.education.degree} onChange={v => setProfile({...profile, education: {...profile.education, degree: v}})} />
                    <Field label="Major" value={profile.education.major} onChange={v => setProfile({...profile, education: {...profile.education, major: v}})} />
                    <Field label="University" value={profile.education.university} onChange={v => setProfile({...profile, education: {...profile.education, university: v}})} />
                    <Field label="Graduation Year" value={profile.education.graduation_year} onChange={v => setProfile({...profile, education: {...profile.education, graduation_year: v}})} />
                  </div>
                )}

                {activeTab === 'salary' && (
                  <div className="space-y-4 anim-fade-up">
                    <h3 className="text-sm font-bold text-indigo-400 uppercase tracking-wider mb-4">Preferences</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Target Salary" value={profile.salary_expectations.target} onChange={v => setProfile({...profile, salary_expectations: {...profile.salary_expectations, target: v}})} />
                      <Field label="Currency" value={profile.salary_expectations.currency} onChange={v => setProfile({...profile, salary_expectations: {...profile.salary_expectations, currency: v}})} />
                    </div>
                    <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/5">
                      <div>
                        <p className="text-sm font-bold text-slate-200">Willing to Relocate</p>
                        <p className="text-xs text-slate-500">Enable this if you are open to moving</p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={profile.preferences.willing_to_relocate} 
                        onChange={e => setProfile({...profile, preferences: {...profile.preferences, willing_to_relocate: e.target.checked}})}
                        className="w-5 h-5 rounded border-white/10 bg-slate-950 text-indigo-600 focus:ring-indigo-500/50"
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-5 border-t border-white/5 bg-slate-900/50 flex items-center justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2 rounded-xl text-sm font-bold text-slate-400 hover:text-slate-200 transition-colors">
            Cancel
          </button>
          <button 
            onClick={handleSave} 
            disabled={saving || loading}
            className="btn-primary px-6 h-10"
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            ) : (
              <><Save className="w-4 h-4" /> Save Changes</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: any) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all duration-200 ${
        active 
          ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-500/20' 
          : 'text-slate-500 hover:bg-white/5 hover:text-slate-300 border border-transparent'
      }`}
    >
      <Icon className={`w-4 h-4 ${active ? 'text-indigo-400' : 'text-slate-600'}`} />
      <span>{label}</span>
    </button>
  );
}

function Field({ label, value, onChange, type = 'text' }: any) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider ml-1">{label}</label>
      <input
        type={type}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        className="w-full bg-slate-950 border border-white/5 rounded-xl px-4 py-2.5 text-slate-200 text-sm focus:outline-none focus:border-indigo-500/50 transition-colors"
      />
    </div>
  );
}

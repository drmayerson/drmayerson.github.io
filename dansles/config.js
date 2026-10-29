// Supabase connection for the shared database (see SETUP.md).
// The publishable key is meant to be public: it can only call the app's functions,
// and those refuse everything without the group key that lives in the shared link.
// Leave both empty to run the demo, which stores everything in this browser only.
window.CARPOOL_CONFIG = {
  supabaseUrl: 'https://wgndfxipbxqihpzrjxvo.supabase.co',
  supabaseAnonKey: 'sb_publishable_vpy8J78fKLvgZBuaXi8Ntw_VLHBx2-Y',
};

!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "$DOCUMENTS\boardtutor\memory"
  CreateDirectory "$DOCUMENTS\boardtutor\skills"
  CreateDirectory "$DOCUMENTS\boardtutor\whiteboards"
!macroend

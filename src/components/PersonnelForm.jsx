import React, { useState } from 'react';
import { TextField, Button, Box, Paper, Typography } from '@mui/material';

const PersonnelForm = ({ addPersonnel }) => {
  const [rut, setRut] = useState('');
  const [nombres, setNombres] = useState('');
  const [apellidos, setApellidos] = useState('');
  const [telefono, setTelefono] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [actividad, setActividad] = useState('');
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaTermino, setFechaTermino] = useState('');
  const [personaACargo, setPersonaACargo] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!rut || !nombres || !apellidos || !telefono || !empresa || !actividad || !fechaInicio || !fechaTermino || !personaACargo) {
      alert('Por favor, complete todos los campos.');
      return;
    }
    addPersonnel({ rut, nombres, apellidos, telefono, empresa, actividad, fechaInicio, fechaTermino, personaACargo });
    setRut('');
    setNombres('');
    setApellidos('');
    setTelefono('');
    setEmpresa('');
    setActividad('');
    setFechaInicio('');
    setFechaTermino('');
    setPersonaACargo('');
  };

  return (
    <Paper elevation={3} sx={{ p: 4, mb: 4 }}>
      <Typography variant="h6" gutterBottom>
        Formulario de Acceso
      </Typography>
      <Box component="form" onSubmit={handleSubmit}>
        <TextField required label="RUT" value={rut} onChange={(e) => setRut(e.target.value)} fullWidth margin="normal" />
        <TextField required label="Nombres" value={nombres} onChange={(e) => setNombres(e.target.value)} fullWidth margin="normal" />
        <TextField required label="Apellidos" value={apellidos} onChange={(e) => setApellidos(e.target.value)} fullWidth margin="normal" />
        <TextField required label="Teléfono" value={telefono} onChange={(e) => setTelefono(e.target.value)} fullWidth margin="normal" />
        <TextField required label="Empresa" value={empresa} onChange={(e) => setEmpresa(e.target.value)} fullWidth margin="normal" />
        <TextField required label="Actividad" value={actividad} onChange={(e) => setActividad(e.target.value)} fullWidth margin="normal" />
        <TextField required label="Persona a Cargo" value={personaACargo} onChange={(e) => setPersonaACargo(e.target.value)} fullWidth margin="normal" />
        <TextField
          required
          label="Fecha de Inicio"
          type="date"
          value={fechaInicio}
          onChange={(e) => setFechaInicio(e.target.value)}
          fullWidth
          margin="normal"
          InputLabelProps={{
            shrink: true,
          }}
        />
        <TextField
          required
          label="Fecha de Término"
          type="date"
          value={fechaTermino}
          onChange={(e) => setFechaTermino(e.target.value)}
          fullWidth
          margin="normal"
          InputLabelProps={{
            shrink: true,
          }}
        />
        <Button type="submit" variant="contained" color="primary" sx={{ mt: 2 }}>Agregar Personal</Button>
      </Box>
    </Paper>
  );
};

export default PersonnelForm;

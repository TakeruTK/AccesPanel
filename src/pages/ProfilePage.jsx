import React, { useState, useMemo } from 'react';
import { CSVLink } from 'react-csv';
import PersonnelForm from '../components/PersonnelForm';
import PersonnelList from '../components/PersonnelList';
import { Box, Button, TextField, Typography, Grid } from '@mui/material';

export const initialPersonnel = [
  { rut: '1', nombres: 'Ana', apellidos: 'García', telefono: '987654321', empresa: 'Empresa A', actividad: 'Desarrollo', fechaInicio: '2024-01-15', fechaTermino: '2024-07-15', personaACargo: 'Jefe de Proyecto' },
  { rut: '2', nombres: 'Luis', apellidos: 'Martínez', telefono: '987654322', empresa: 'Empresa B', actividad: 'Diseño', fechaInicio: '2024-02-01', fechaTermino: '2024-08-01', personaACargo: 'Líder de Diseño' },
  { rut: '3', nombres: 'Elena', apellidos: 'Rodríguez', telefono: '987654323', empresa: 'Empresa A', actividad: 'QA', fechaInicio: '2024-03-10', fechaTermino: '2024-09-10', personaACargo: 'Jefe de Proyecto' },
  { rut: '4', nombres: 'Carlos', apellidos: 'Sánchez', telefono: '987654324', empresa: 'Empresa C', actividad: 'Marketing', fechaInicio: '2024-01-20', fechaTermino: '2024-07-20', personaACargo: 'Director de Marketing' },
  { rut: '5', nombres: 'Laura', apellidos: 'Pérez', telefono: '987654325', empresa: 'Empresa B', actividad: 'Desarrollo', fechaInicio: '2024-04-05', fechaTermino: '2024-10-05', personaACargo: 'Líder de Diseño' },
  { rut: '6', nombres: 'Miguel', apellidos: 'Gómez', telefono: '987654326', empresa: 'Empresa A', actividad: 'Diseño', fechaInicio: '2024-05-01', fechaTermino: '2024-11-01', personaACargo: 'Jefe de Proyecto' },
  { rut: '7', nombres: 'Sofía', apellidos: 'Díaz', telefono: '987654327', empresa: 'Empresa C', actividad: 'QA', fechaInicio: '2024-02-15', fechaTermino: '2024-08-15', personaACargo: 'Director de Marketing' },
  { rut: '8', nombres: 'Javier', apellidos: 'Moreno', telefono: '987654328', empresa: 'Empresa B', actividad: 'Marketing', fechaInicio: '2024-06-01', fechaTermino: '2024-12-01', personaACargo: 'Líder de Diseño' },
  { rut: '9', nombres: 'Paula', apellidos: 'Jiménez', telefono: '987654329', empresa: 'Empresa A', actividad: 'Desarrollo', fechaInicio: '2024-03-25', fechaTermino: '2024-09-25', personaACargo: 'Jefe de Proyecto' },
  { rut: '10', nombres: 'David', apellidos: 'Muñoz', telefono: '987654330', empresa: 'Empresa C', actividad: 'Diseño', fechaInicio: '2024-07-01', fechaTermino: '2025-01-01', personaACargo: 'Director de Marketing' },
];

const ProfilePage = () => {
  const [personnel, setPersonnel] = useState(initialPersonnel);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const addPersonnel = (person) => {
    setPersonnel([...personnel, person]);
  };

  const filteredPersonnel = useMemo(() => {
    if (!startDate || !endDate) {
      return personnel;
    }
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T23:59:59');

    return personnel.filter(p => {
        const personStart = new Date(p.fechaInicio + 'T00:00:00');
        const personEnd = new Date(p.fechaTermino + 'T23:59:59');
        return personStart <= end && personEnd >= start;
    });
  }, [personnel, startDate, endDate]);
  
  const formatDate = (date) => {
    return date.toISOString().split('T')[0];
  }

  const setDateRange = (start, end) => {
    setStartDate(formatDate(start));
    setEndDate(formatDate(end));
  }

  const setToday = () => {
    const today = new Date();
    setDateRange(today, today);
  };

  const setThisWeek = () => {
    const today = new Date();
    const first = today.getDate() - today.getDay();
    const last = first + 6;
    const firstDay = new Date(today.setDate(first));
    const lastDay = new Date(new Date().setDate(last));
    setDateRange(firstDay, lastDay);
  };

  const setThisMonth = () => {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    setDateRange(firstDay, lastDay);
  };

  const setLast3Months = () => {
    const today = new Date();
    const threeMonthsAgo = new Date(new Date().setMonth(today.getMonth() - 3));
    setDateRange(threeMonthsAgo, today);
  };

  const csvHeaders = [
    { label: "RUT", key: "rut" },
    { label: "Nombres", key: "nombres" },
    { label: "Apellidos", key: "apellidos" },
    { label: "Teléfono", key: "telefono" },
    { label: "Empresa", key: "empresa" },
    { label: "Actividad", key: "actividad" },
    { label: "Fecha de Inicio", key: "fechaInicio" },
    { label: "Fecha de Término", key: "fechaTermino" },
    { label: "Persona a Cargo", key: "personaACargo" },
  ];

  return (
    <Box sx={{ p: 3 }}>
      <PersonnelForm addPersonnel={addPersonnel} />

      <Box sx={{ mt: 4, mb: 2, p: 2, border: '1px solid #ddd', borderRadius: '4px' }}>
        <Typography variant="h6" gutterBottom>Reportes de Personal</Typography>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={3}>
            <TextField
              label="Fecha de Inicio"
              type="date"
              fullWidth
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} sm={3}>
            <TextField
              label="Fecha de Término"
              type="date"
              fullWidth
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Grid>
          <Grid item xs={12} sm={6} container spacing={1}>
             <Grid item><Button variant="outlined" onClick={setToday}>Hoy</Button></Grid>
             <Grid item><Button variant="outlined" onClick={setThisWeek}>Esta Semana</Button></Grid>
             <Grid item><Button variant="outlined" onClick={setThisMonth}>Este Mes</Button></Grid>
             <Grid item><Button variant="outlined" onClick={setLast3Months}>Últimos 3 Meses</Button></Grid>
             <Grid item><Button variant="contained" color="secondary" onClick={() => {setStartDate(''); setEndDate('');}}>Limpiar</Button></Grid>
          </Grid>
        </Grid>
         <Box sx={{ mt: 2 }}>
            <CSVLink
                data={filteredPersonnel}
                headers={csvHeaders}
                filename={"reporte_personal.csv"}
                style={{ textDecoration: 'none' }}
            >
                <Button variant="contained" color="primary">
                    Descargar CSV
                </Button>
            </CSVLink>
        </Box>
      </Box>

      <PersonnelList personnel={filteredPersonnel} />
    </Box>
  );
};

export default ProfilePage;
